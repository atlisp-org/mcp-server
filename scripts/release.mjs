#!/usr/bin/env node
// 发布脚本：node scripts/release.mjs <patch|minor|major>
// 1. bump package.json / package-lock.json 版本
// 2. 从上个 tag 以来的提交生成 CHANGELOG 条目并前置插入
// 3. 提交 + 打 git tag vX.Y.Z（不自动 push）
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const bump = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('用法: node scripts/release.mjs <patch|minor|major>');
  process.exit(1);
}

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

const lastTag = (() => {
  try {
    return git('describe --tags --abbrev=0');
  } catch {
    try {
      return git('rev-list --max-parents=0 HEAD');
    } catch {
      return 'HEAD';
    }
  }
})();

const out = execSync(`npm version ${bump} --no-git-tag-version`, { encoding: 'utf8' });
const version = out.trim().replace(/^v/, '');
const today = new Date().toISOString().slice(0, 10);

let logRange = `${lastTag}..HEAD`;
let commits;
try {
  commits = git(`log ${logRange} --pretty=format:"- %s (%h)"`);
} catch {
  commits = '';
}
if (!commits) {
  logRange = 'HEAD~10..HEAD';
  try {
    commits = git(`log ${logRange} --pretty=format:"- %s (%h)"`);
  } catch {
    commits = `- release v${version}`;
  }
}

const entry = `\n## [${version}] - ${today}\n\n### 更新内容\n\n${commits}\n`;

const changelogPath = new URL('../CHANGELOG.md', import.meta.url);
let content = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '# Changelog\n';
const headerEnd = content.indexOf('\n## ');
content =
  headerEnd === -1
    ? content.trimEnd() + '\n' + entry
    : content.slice(0, headerEnd) + entry + '\n' + content.slice(headerEnd + 1);
fs.writeFileSync(changelogPath, content);

git('add CHANGELOG.md package.json package-lock.json');
git(`commit -m "chore: release v${version}"`);
git(`tag v${version}`);
console.log(`\n已发布 v${version}（commit + tag 已创建，尚未 push）。推送: git push && git push --tags`);
