#!/usr/bin/env node

/**
 * MCP 连接压力测试脚本
 * 测试高频调用下的连接稳定性
 */

import { createCadConnection, cad } from '../src/cad.js';

const TEST_DURATION = 30000; // 30秒测试
const CONCURRENT_REQUESTS = 10; // 并发请求数
const REQUEST_INTERVAL = 100; // 请求间隔（毫秒）

let requestCount = 0;
let successCount = 0;
let errorCount = 0;
let timeoutCount = 0;
let connectionErrors = 0;
const errors = new Map();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(conn, requestId) {
  requestCount++;
  try {
    // 模拟不同的操作
    const operations = [
      '(getvar "clayer")',
      '(princ "test")',
      '(+ 1 2)',
      '(getvar "cmdecho")',
    ];
    
    const code = operations[requestId % operations.length];
    const result = await conn.sendCommandWithResult(code);
    successCount++;
    return { success: true, result };
  } catch (error) {
    errorCount++;
    const errorType = error.message.includes('停滞') ? 'stall' : 
                     error.message.includes('timeout') ? 'timeout' : 'other';
    
    if (errorType === 'stall') {
      connectionErrors++;
    }
    
    errors.set(errorType, (errors.get(errorType) || 0) + 1);
    
    return { success: false, error: error.message, type: errorType };
  }
}

async function runStressTest() {
  console.log('=== MCP 连接压力测试 ===');
  console.log(`测试时长: ${TEST_DURATION}ms`);
  console.log(`并发请求数: ${CONCURRENT_REQUESTS}`);
  console.log(`请求间隔: ${REQUEST_INTERVAL}ms`);
  console.log('');

  const conn = createCadConnection();
  
  try {
    // 尝试连接
    console.log('正在连接到 CAD...');
    const connected = await conn.connect('AutoCAD');
    if (!connected) {
      console.error('无法连接到 CAD，请确保 CAD 已启动');
      process.exit(1);
    }
    console.log('连接成功！');
    console.log('');

    const startTime = Date.now();
    let lastProgressTime = startTime;
    
    // 启动多个并发请求
    const promises = [];
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
      promises.push((async () => {
        while (Date.now() - startTime < TEST_DURATION) {
          await makeRequest(conn, requestCount);
          await sleep(REQUEST_INTERVAL);
        }
      })());
    }

    // 定期输出进度
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, (elapsed / TEST_DURATION) * 100);
      const requestsPerSecond = (requestCount / (elapsed / 1000)).toFixed(2);
      
      process.stdout.write(`\r进度: ${progress.toFixed(1)}% | 请求: ${requestCount} | 成功: ${successCount} | 失败: ${errorCount} | QPS: ${requestsPerSecond}`);
    }, 1000);

    // 等待所有请求完成
    await Promise.all(promises);
    clearInterval(progressInterval);

    const totalTime = Date.now() - startTime;
    console.log('\n');
    console.log('=== 测试结果 ===');
    console.log(`总耗时: ${totalTime}ms`);
    console.log(`总请求数: ${requestCount}`);
    console.log(`成功数: ${successCount}`);
    console.log(`失败数: ${errorCount}`);
    console.log(`成功率: ${((successCount / requestCount) * 100).toFixed(2)}%`);
    console.log(`平均QPS: ${(requestCount / (totalTime / 1000)).toFixed(2)}`);
    console.log('');
    
    if (errors.size > 0) {
      console.log('=== 错误分布 ===');
      for (const [type, count] of errors) {
        console.log(`${type}: ${count}`);
      }
    }

    // 检查连接状态
    console.log('');
    console.log('=== 连接状态 ===');
    console.log(`连接状态: ${conn.connected ? '已连接' : '未连接'}`);
    console.log(`停滞状态: ${conn.isStalled() ? '是' : '否'}`);
    console.log(`队列大小: ${conn._getQueueSize()}`);
    console.log(`重启次数: ${conn._getRestartCount()}`);

  } catch (error) {
    console.error('测试过程中发生错误:', error);
  } finally {
    try {
      await conn.disconnect();
    } catch (e) {
      // 忽略断开连接时的错误
    }
  }
}

// 运行测试
runStressTest().catch(console.error);