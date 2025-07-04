// File: src/services/ErrorService.js

import { getDebugModeAsync, CONFIG } from "../config.js";
import NotificationManager from "../managers/NotificationManager.js";
import { openOptionsPage } from "../utils/helpers.js";
import { matchErrorToType } from "./ErrorMatcher.js";
import { getErrorMessage } from "./ErrorMessages.js";
import { ErrorTypes } from "./ErrorTypes.js";

const SILENT = new Set([ErrorTypes.CONTEXT]);
const SUPPRESS_CONSOLE = new Set([
  ErrorTypes.CONTEXT,
  ErrorTypes.API,
  ErrorTypes.API_KEY_INVALID,
  ErrorTypes.API_KEY_MISSING,
  ErrorTypes.API_URL_MISSING,
  ErrorTypes.MODEL_MISSING,
  ErrorTypes.MODEL_OVERLOADED,
  ErrorTypes.QUOTA_EXCEEDED,
  ErrorTypes.GEMINI_QUOTA_REGION,
  ErrorTypes.NETWORK_ERROR,
  ErrorTypes.HTTP_ERROR,
  ErrorTypes.INTEGRATION,
  ErrorTypes.SERVICE,
  ErrorTypes.VALIDATION,
  ErrorTypes.UI,
  ErrorTypes.PROMPT_INVALID,
  ErrorTypes.TEXT_EMPTY,
  ErrorTypes.TEXT_TOO_LONG,
  ErrorTypes.TRANSLATION_NOT_FOUND,
  ErrorTypes.TRANSLATION_FAILED,
  ErrorTypes.TAB_AVAILABILITY,
]);
const OPEN_SETTINGS = new Set([
  ErrorTypes.API_KEY_INVALID,
  ErrorTypes.API_KEY_MISSING,
  ErrorTypes.MODEL_OVERLOADED,
  ErrorTypes.MODEL_MISSING,
  ErrorTypes.API_URL_MISSING,
  ErrorTypes.QUOTA_EXCEEDED,
  ErrorTypes.HTTP_ERROR,
  ErrorTypes.GEMINI_QUOTA_REGION,
]);

export class ErrorHandler {
  constructor() {
    this.notifier = new NotificationManager();
    this.displayedErrors = new Set();
    this.handling = false;
  }
  static async processError(err) {
    return err?.then ? await err : err;
  }
  async handle(err, meta = {}) {
    if (this.handling) return err;
    this.handling = true;
    try {
      const raw = err instanceof Error ? err.message : String(err);
      const type = matchErrorToType(raw);
      const msg = await getErrorMessage(type);
      const debug = await getDebugModeAsync().catch(() => CONFIG.DEBUG_MODE);
      if (debug && !SUPPRESS_CONSOLE.has(type)) {
        console.error(`[${type}] ${raw}`, err.stack);
      }
      if (SILENT.has(type)) return err;

      const action = OPEN_SETTINGS.has(type) ? () => openOptionsPage("api") : undefined;

      this._notifyUser(msg, meta.type || ErrorTypes.SERVICE, action);
      return err;
    } finally {
      this.handling = false;
    }
  }

  _logError(error, meta) {
    console.error(
      `[ErrorService] ${error.name}: ${error.message}\nContext: ${meta.context}\nType: ${meta.type}\nStack: ${error.stack}`
    );
  }

  _notifyUser(message, type, action) {
    if (this.displayedErrors.has(message)) return;
    const typeMap = {
      [ErrorTypes.API]: "error",
      [ErrorTypes.UI]: "error",
      [ErrorTypes.NETWORK_ERROR]: "warning",
      [ErrorTypes.HTTP_ERROR]: "warning",
      [ErrorTypes.SERVICE]: "error",
      [ErrorTypes.CONTEXT]: "warning",
      [ErrorTypes.VALIDATION]: "warning",
      [ErrorTypes.INTEGRATION]: "warning",
      [ErrorTypes.API_KEY_INVALID]: "error",
      [ErrorTypes.API_KEY_MISSING]: "error",
      [ErrorTypes.API_URL_MISSING]: "error",
      [ErrorTypes.MODEL_MISSING]: "error",
      [ErrorTypes.MODEL_OVERLOADED]: "warning",
      [ErrorTypes.QUOTA_EXCEEDED]: "warning",
      [ErrorTypes.GEMINI_QUOTA_REGION]: "warning",
    };
    const toastType = typeMap[type] || "error";
    this.notifier.show(message, toastType, true, 4000, action);
    this.displayedErrors.add(message);
    setTimeout(() => this.displayedErrors.delete(message), 4500);
  }
}

export async function handleUIError(err, context = "") {
  const handler = new ErrorHandler();
  return handler.handle(err, { type: ErrorTypes.UI, context });
}
