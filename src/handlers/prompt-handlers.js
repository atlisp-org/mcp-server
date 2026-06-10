import { listPrompts as loaderList, getPrompt as loaderGet } from '../prompts/loader.js';

export async function listPrompts() {
  return loaderList();
}

export async function getPrompt(name, arguments_ = {}) {
  return loaderGet(name, arguments_);
}
