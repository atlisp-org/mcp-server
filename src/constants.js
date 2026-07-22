export const CAD_PLATFORMS = ['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD'];
export const FILE_EXTENSIONS = {
    'AutoCAD': ['.fas', '.vlx'],
    'ZWCAD': ['.zelx', '.vls'],
    'GStarCAD': ['.fas', '.vlx'],
    'BricsCAD': ['.des']
};

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version } = require(path.join(__dirname, '..', 'package.json'));

export const PROTOCOL_VERSION = '2024-11-05';
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
    'atlisp://dwg/text-content', 'atlisp://cad/dwgs', 'atlisp://packages'
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
