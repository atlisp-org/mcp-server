import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlisp-task-handlers-'));
process.env.ATLISP_TASKS_FILE = path.join(dir, 'tasks.json');

const mockHandle = vi.fn(async (name, args, options) => {
  options?.notifyProgress?.(1, 1, `${name} done`);
  return { content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }] };
});

vi.mock('../../src/tool-executor.js', () => ({ handleToolCall: mockHandle }));

let handlers;
let taskEngine;

beforeAll(async () => {
  handlers = await import('../../src/handlers/task-handlers.js');
  ({ taskEngine } = await import('../../src/task-engine.js'));
});

afterAll(() => {
  taskEngine.reset();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.ATLISP_TASKS_FILE;
});

const parse = (result) => JSON.parse(result.content[0].text);

describe('task handlers', () => {
  it('task_submit 返回 taskId 并用真实工具执行', async () => {
    const view = parse(await handlers.taskSubmit({ tool: 'get_cad_info', args: {} }));
    expect(view.ok).toBe(true);
    expect(view.taskId).toMatch(/^task_/);

    const done = await taskEngine.wait(view.taskId, 2000);
    expect(done.status).toBe('succeeded');
    expect(mockHandle).toHaveBeenCalledWith('get_cad_info', {}, expect.objectContaining({ correlationId: view.taskId }));
  });

  it('未知工具直接拒绝，不创建任务', async () => {
    const before = taskEngine.list().total;
    const result = await handlers.taskSubmit({ tool: 'not_a_tool' });
    expect(parse(result).ok).toBe(false);
    expect(taskEngine.list().total).toBe(before);
  });

  it('task_status / task_list 可查询', async () => {
    const view = parse(await handlers.taskSubmit({ tool: 'get_cad_info' }));
    await taskEngine.wait(view.taskId, 2000);

    const status = parse(await handlers.taskStatus({ taskId: view.taskId }));
    expect(status.status).toBe('succeeded');

    const list = parse(await handlers.taskList({ status: 'succeeded' }));
    expect(list.tasks.some((t) => t.taskId === view.taskId)).toBe(true);
  });

  it('task_result 返回与同步调用一致的 content', async () => {
    const view = parse(await handlers.taskSubmit({ tool: 'get_cad_info' }));
    const result = await handlers.taskResult({ taskId: view.taskId, waitMs: 2000 });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).tool).toBe('get_cad_info');
  });

  it('失败任务通过 task_result 返回 isError', async () => {
    mockHandle.mockImplementationOnce(async () => ({
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    }));
    const view = parse(await handlers.taskSubmit({ tool: 'get_cad_info' }));
    const result = await handlers.taskResult({ taskId: view.taskId, waitMs: 2000 });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).status).toBe('failed');
  });
});
