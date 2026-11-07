import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskEngine, TASKS_FILE } from '../../src/task-engine.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const ok = (text = 'ok') => ({ content: [{ type: 'text', text }] });

describe('TaskEngine', () => {
  let dir;
  let file;
  let engine;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlisp-task-'));
    file = path.join(dir, 'tasks.json');
    engine = new TaskEngine({ file, concurrency: 2 });
  });

  afterEach(() => {
    engine.reset({ keepFile: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('默认任务文件位于 ~/.atlisp/tasks.json', () => {
    expect(TASKS_FILE).toContain(path.join('@lisp', 'tasks.json'));
  });

  it('提交后异步执行并保留结果', async () => {
    const view = engine.submit({ tool: 'get_cad_info' }, async () => ok('cad ok'));
    expect(['queued', 'running']).toContain(view.status);
    expect(view.taskId).toMatch(/^task_[0-9a-f]{12}$/);

    const done = await engine.wait(view.taskId, 2000);
    expect(done.status).toBe('succeeded');
    expect(done.result.content[0].text).toBe('cad ok');
    expect(done.finishedAt).toBeTruthy();
  });

  it('工具返回 isError 时任务标记失败', async () => {
    const view = engine.submit({ tool: 'boom' }, async () => ({
      content: [{ type: 'text', text: 'CAD 未连接' }],
      isError: true,
    }));
    const done = await engine.wait(view.taskId, 2000);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('CAD 未连接');
  });

  it('执行器抛异常时任务标记失败', async () => {
    const view = engine.submit({ tool: 'boom' }, async () => { throw new Error('kaboom'); });
    const done = await engine.wait(view.taskId, 2000);
    expect(done.status).toBe('failed');
    expect(done.error).toBe('kaboom');
  });

  it('并发上限生效，超出的任务排队', async () => {
    let active = 0;
    let maxActive = 0;
    const executor = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 30));
      active -= 1;
      return ok();
    };

    const views = Array.from({ length: 4 }, (_, i) => engine.submit({ tool: `t${i}` }, executor));
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.list().tasks.filter((t) => t.status === 'running')).toHaveLength(2);
    expect(engine.list().tasks.filter((t) => t.status === 'queued')).toHaveLength(2);

    const settled = await Promise.all(views.map((v) => engine.wait(v.taskId, 3000)));
    expect(settled.every((t) => t.status === 'succeeded')).toBe(true);
    expect(maxActive).toBe(2);
  });

  it('取消排队中的任务：立即变为 cancelled 且不会执行', async () => {
    const queueEngine = new TaskEngine({ file: path.join(dir, 'queue.json'), concurrency: 1 });
    const gate = deferred();
    let secondExecuted = false;
    const first = queueEngine.submit({ tool: 'blocker' }, async () => {
      await gate.promise;
      return ok();
    });
    // 事件循环转一圈，确保第一个任务已进入 running 并占住唯一并发位
    await new Promise((r) => setTimeout(r, 10));
    const second = queueEngine.submit({ tool: 'never' }, async () => {
      secondExecuted = true;
      return ok();
    });
    expect(queueEngine.get(second.taskId).status).toBe('queued');

    const cancelled = queueEngine.cancel(second.taskId);
    expect(cancelled.status).toBe('cancelled');

    gate.resolve();
    await queueEngine.wait(first.taskId, 2000);
    expect(queueEngine.get(second.taskId).status).toBe('cancelled');
    expect(secondExecuted).toBe(false);
  });

  it('取消运行中的任务：请求记录在当前步骤结束后生效', async () => {
    const gate = deferred();
    const view = engine.submit({ tool: 'slow' }, async () => {
      await gate.promise;
      return ok('late');
    });
    await new Promise((r) => setTimeout(r, 10));

    const cancelled = engine.cancel(view.taskId);
    expect(cancelled.status).toBe('running');
    expect(cancelled.cancelRequested).toBe(true);

    gate.resolve();
    const done = await engine.wait(view.taskId, 2000);
    expect(done.status).toBe('cancelled');
  });

  it('拒绝提交 task_ 工具，防止递归', () => {
    expect(() => engine.submit({ tool: 'task_status' }, async () => ok())).toThrow(/禁止递归/);
  });

  it('超时任务标记失败', async () => {
    const view = engine.submit({ tool: 'hang', timeoutMs: 30 }, async () => {
      await new Promise((r) => setTimeout(r, 500));
      return ok();
    });
    const done = await engine.wait(view.taskId, 2000);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('超过');
  });

  it('持久化：新实例能读到已完成任务', async () => {
    const view = engine.submit({ tool: 'persist' }, async () => ok('saved'));
    await engine.wait(view.taskId, 2000);

    const reloaded = new TaskEngine({ file });
    const task = reloaded.get(view.taskId, { withResult: true });
    expect(task.status).toBe('succeeded');
    expect(task.tool).toBe('persist');
  });

  it('重启恢复：running/queued 任务标记为失败', () => {
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      tasks: [
        { id: 'task_running', tool: 'a', status: 'running', createdAt: new Date().toISOString(), progress: {} },
        { id: 'task_done', tool: 'b', status: 'succeeded', createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(), progress: {} },
      ],
    }));

    const reloaded = new TaskEngine({ file });
    expect(reloaded.get('task_running').status).toBe('failed');
    expect(reloaded.get('task_running').error).toContain('重启');
    expect(reloaded.get('task_done').status).toBe('succeeded');
  });

  it('未知任务 ID 返回 TASK_NOT_FOUND', () => {
    expect(() => engine.get('task_missing')).toThrow(/任务不存在|不存在/);
  });

  it('超大结果被截断，不写爆磁盘', async () => {
    const big = 'x'.repeat(300 * 1024);
    const view = engine.submit({ tool: 'big' }, async () => ok(big));
    const done = await engine.wait(view.taskId, 2000);
    expect(done.status).toBe('succeeded');
    const saved = fs.readFileSync(file, 'utf8');
    expect(saved.length).toBeLessThan(300 * 1024);
    expect(done.result.truncated).toBe(true);
  });
});
