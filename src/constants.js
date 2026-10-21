export const CAD_PLATFORMS = ['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD'];
export const FILE_EXTENSIONS = {
    'AutoCAD': ['.fas', '.vlx'],
    'ZWCAD': ['.zelx', '.vls'],
    'GStarCAD': ['.fas', '.vlx'],
    'BricsCAD': ['.des']
};

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version } = require(path.join(__dirname, '..', 'package.json'));

/**
 * dist/build-meta.json：构建时写入的版本/提交，用来识别「package.json 是新的、
 * dist 还是旧构建」的情况（运行时 SERVER_VERSION 读的是 package.json，发现不了）。
 * 源码模式（node src/atlisp-mcp.js）下不存在 dist 元数据，返回 null。
 */
function readBuildMeta() {
    const candidates = [
        path.join(__dirname, 'build-meta.json'),
        path.join(__dirname, '..', 'dist', 'build-meta.json'),
    ];
    for (const file of candidates) {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            // 试下一个位置
        }
    }
    return null;
}

export const BUILD_META = readBuildMeta();

/**
 * 协议版本不再写死，直接取 SDK 内置的最新版本（当前 2025-11-25）。
 * Server 端握手时会按 SDK 的 SUPPORTED_PROTOCOL_VERSIONS 与客户端协商，
 * 旧客户端（如 2024-11-05）仍可正常回退连接；此常量用于 mcp-scanner 探测与展示。
 */
export const PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;
export const SERVER_NAME = 'atlisp-mcp-server';
export const SERVER_VERSION = version;

export const SERVER_CAPABILITIES = {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
    completions: {},

};

/** @deprecated Use actual package system via list_packages/search_packages tools instead */
export const MOCK_PACKAGES = [];

/** Resource URIs used for subscription notifications across instance switches */
export const CAD_RESOURCE_URIS = [
    'atlisp://cad/info', 'atlisp://dwg/name', 'atlisp://dwg/path',
    'atlisp://dwg/entities', 'atlisp://dwg/tbl', 'atlisp://dwg/block-refs',
    'atlisp://dwg/text-content', 'atlisp://cad/dwgs', 'atlisp://packages',
    'atlisp://dwg/frames',
];

/** Order of CAD platforms to try when auto-launching */
export const AUTO_LAUNCH_PLATFORMS = ['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD'];

/** Registry paths for detecting CAD installations (Windows) */
export const CAD_REGISTRY_PATHS = {
    'AutoCAD': {
        root: 'SOFTWARE\\Autodesk\\AutoCAD',
        keyPattern: /^R\d+(\.\d+)?$/,
        subKey: 'ACAD-\\d+:\\d+',
        exe: 'acad.exe',
    },
    'ZWCAD': {
        root: 'SOFTWARE\\ZWSOFT\\ZWCAD',
        keyPattern: /^\d+(\.\d+)?$/,
        subKey: null,
        exe: 'zwcad.exe',
    },
    'GStarCAD': {
        root: 'SOFTWARE\\GStarSoft\\GStarCAD',
        keyPattern: /^\d+(\.\d+)?$/,
        subKey: null,
        exe: 'gstarcad.exe',
    },
    'BricsCAD': {
        root: 'SOFTWARE\\Bricsys\\BricsCAD',
        keyPattern: /^\d+(\.\d+)?$/,
        subKey: null,
        exe: 'bricscad.exe',
    },
};
