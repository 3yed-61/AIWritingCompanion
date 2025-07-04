// src/core/api.js
import Browser from "webextension-polyfill";
import {
  CONFIG,
  getApiKeyAsync,
  getUseMockAsync,
  getApiUrlAsync,
  getSourceLanguageAsync,
  getTargetLanguageAsync,
  getTranslationApiAsync,
  getGoogleTranslateUrlAsync,
  getWebAIApiUrlAsync,
  getWebAIApiModelAsync,
  getOpenAIApiKeyAsync,
  getOpenAIApiUrlAsync,
  getOpenAIModelAsync,
  getOpenRouterApiKeyAsync,
  getOpenRouterApiModelAsync,
  getDeepSeekApiKeyAsync,
  getDeepSeekApiModelAsync,
  getCustomApiUrlAsync,
  getCustomApiKeyAsync,
  getCustomApiModelAsync,
  TranslationMode,
} from "../config.js";
import { delay, isExtensionContextValid } from "../utils/helpers.js";
import { buildPrompt } from "../utils/promptBuilder.js";
import { isPersianText } from "../utils/textDetection.js";
import { AUTO_DETECT_VALUE } from "../utils/tts.js";
import { ErrorTypes } from "../services/ErrorTypes.js";

const MOCK_DELAY = 500;
const TEXT_DELIMITER = "\n\n---\n\n";

// A simple map for converting full language names to Google Translate's codes.
const langNameToCodeMap = {
  farsi: "fa",
  persian: "fa",
  english: "en",
  german: "de",
  french: "fr",
  spanish: "es",
  arabic: "ar",
  russian: "ru",
  japanese: "ja",
  korean: "ko",
  // Add other common languages as needed
};

class ApiService {
  constructor() {
    this.sessionContext = null;
  }

  _isSpecificTextJsonFormat(obj) {
    return (
      Array.isArray(obj) &&
      obj.length > 0 &&
      obj.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          typeof item.text === "string"
      )
    );
  }

  _buildMessagePayload(options) {
    let promptText = "";
    try {
      const bodyObj = JSON.parse(options.fetchOptions.body);
      if (
        bodyObj.contents &&
        Array.isArray(bodyObj.contents) &&
        bodyObj.contents[0].parts
      ) {
        promptText = bodyObj.contents[0].parts[0].text;
      } else if (bodyObj.message) {
        promptText = bodyObj.message;
      } else if (
        bodyObj.messages &&
        Array.isArray(bodyObj.messages) &&
        bodyObj.messages[0].content
      ) {
        promptText = bodyObj.messages[0].content;
      }
    } catch {
      // leave promptText empty
    }
    return {
      promptText,
      sourceLanguage: options.sourceLanguage || AUTO_DETECT_VALUE,
      targetLanguage: options.targetLanguage || AUTO_DETECT_VALUE,
      translationMode: options.translationMode || "",
    };
  }

  /**
   * Executes a fetch call and normalizes HTTP, API-response-invalid, and network errors.
   * @param {Object} params
   * @param {string} params.url - The endpoint URL
   * @param {RequestInit} params.fetchOptions - Fetch options
   * @param {Function} params.extractResponse - Function to extract/transform JSON + status
   * @param {string} params.context - Context for error reporting
   * @returns {Promise<any>} - Transformed result
   * @throws {Error} - With properties: type, statusCode (for HTTP/API), context
   */
  async _executeApiCall({ url, fetchOptions, extractResponse, context }) {
    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        // Extract error details if available
        let body = {};
        try {
          body = await response.json();
        } catch {
          //
        }
        // Use detail or error.message or statusText, fallback to HTTP status
        const msg =
          body.detail ||
          body.error?.message ||
          response.statusText ||
          `HTTP ${response.status}`;
        const err = new Error(msg);
        // Mark as HTTP error (status codes 4xx/5xx)
        err.type = ErrorTypes.HTTP_ERROR;
        err.statusCode = response.status;
        err.context = context;
        throw err;
      }

      // Parse successful response
      const data = await response.json();
      const result = extractResponse(data, response.status);
      if (result === undefined) {
        const err = new Error(ErrorTypes.API_RESPONSE_INVALID);
        err.type = ErrorTypes.API;
        err.statusCode = response.status;
        err.context = context;
        throw err;
      }

      return result;
    } catch (err) {
      // Handle fetch network errors (e.g., offline)
      if (err instanceof TypeError && /NetworkError/.test(err.message)) {
        const networkErr = new Error(err.message);
        networkErr.type = ErrorTypes.NETWORK_ERROR;
        networkErr.context = context;
        throw networkErr;
      }
      // Rethrow existing HTTP/API errors or others
      throw err;
    }
  }

  async handleGoogleTranslate(text, sourceLang, targetLang) {
    if (sourceLang === targetLang) return null;
  
    // --- JSON Mode Detection ---
    let isJsonMode = false;
    let originalJsonStruct;
    let textsToTranslate = [text];
    const context = "api-google-translate";
  
    try {
      const parsed = JSON.parse(text);
      if (this._isSpecificTextJsonFormat(parsed)) {
        isJsonMode = true;
        originalJsonStruct = parsed;
        textsToTranslate = originalJsonStruct.map((item) => item.text);
      }
    } catch (e) {
      // Not a valid JSON, proceed in plain text mode.
    }
  
    // --- URL Construction ---
    const apiUrl = await getGoogleTranslateUrlAsync();
    const getLangCode = (lang) => {
        if (!lang || typeof lang !== 'string') return 'auto';
        const lowerCaseLang = lang.toLowerCase();
        return langNameToCodeMap[lowerCaseLang] || lowerCaseLang;
    }
    const sl = sourceLang === AUTO_DETECT_VALUE ? "auto" : getLangCode(sourceLang);
    const tl = getLangCode(targetLang);
  
    if (sl === tl) return text;
  
    const url = new URL(apiUrl);
    const params = {
      client: "gtx",
      sl: sl,
      tl: tl,
      dt: "t",
      q: textsToTranslate.join(TEXT_DELIMITER),
    };
    url.search = new URLSearchParams(params).toString();
  
    // --- API Call ---
    try {
      const response = await fetch(url.toString(), { method: "GET" });
  
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.type = ErrorTypes.HTTP_ERROR;
        err.statusCode = response.status;
        err.context = context;
        throw err;
      }
  
      const data = await response.json();
  
      // --- Response Parsing ---
      if (!data?.[0]) {
        const err = new Error(ErrorTypes.API_RESPONSE_INVALID);
        err.type = ErrorTypes.API;
        err.context = `${context}-parsing`;
        throw err;
      }
  
      const translatedTextBlob = data[0].map((segment) => segment[0]).join("");
  
      if (isJsonMode) {
        const translatedParts = translatedTextBlob.split(TEXT_DELIMITER);
        if (translatedParts.length !== originalJsonStruct.length) {
          // Fallback if splitting fails to match original structure
          console.warn("Google Translate: JSON reconstruction failed due to segment mismatch.");
          return translatedTextBlob;
        }
        const translatedJson = originalJsonStruct.map((item, index) => ({
          ...item,
          text: translatedParts[index].trim(),
        }));
        return JSON.stringify(translatedJson, null, 2);
      } else {
        return translatedTextBlob;
      }
    } catch (err) {
      if (err instanceof TypeError) {
        const networkErr = new Error(err.message);
        networkErr.type = ErrorTypes.NETWORK_ERROR;
        networkErr.context = `${context}-network`;
        throw networkErr;
      }
      throw err; // Rethrow other errors (HTTP, API)
    }
  }

  async handleGeminiTranslation(text, sourceLang, targetLang, translateMode) {
    if (sourceLang === targetLang) return null;

    const [apiKey, apiUrl] = await Promise.all([
      getApiKeyAsync(),
      getApiUrlAsync(),
    ]);

    if (!apiKey) {
      const err = new Error(ErrorTypes.API_KEY_MISSING);
      err.type = ErrorTypes.API_KEY_MISSING;
      err.context = "api-gemini-translation-apikey";
      throw err;
    }
    if (!apiUrl) {
      const err = new Error(ErrorTypes.API_URL_MISSING);
      err.type = ErrorTypes.API_URL_MISSING;
      err.context = "api-gemini-translation-url";
      throw err;
    }

    const prompt = await buildPrompt(
      text,
      sourceLang,
      targetLang,
      translateMode
    );
    const url = `${apiUrl}?key=${apiKey}`;
    const fetchOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    };

    return this._executeApiCall({
      url,
      fetchOptions,
      extractResponse: (data) =>
        data?.candidates?.[0]?.content?.parts?.[0]?.text,
      context: "api-gemini-translation",
    });
  }

  async handleWebAITranslation(text, sourceLang, targetLang, translateMode) {
    const [apiUrl, apiModel] = await Promise.all([
      getWebAIApiUrlAsync(),
      getWebAIApiModelAsync(),
    ]);

    if (!apiUrl) {
      const err = new Error(ErrorTypes.API_URL_MISSING);
      err.type = ErrorTypes.API;
      err.context = "api-webai-url";
      throw err;
    }
    if (!apiModel) {
      const err = new Error(ErrorTypes.AI_MODEL_MISSING);
      err.type = ErrorTypes.API;
      err.context = "api-webai-model";
      throw err;
    }

    const prompt = await buildPrompt(
      text,
      sourceLang,
      targetLang,
      translateMode
    );
    const fetchOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: prompt,
        model: apiModel,
        images: [],
        reset_session: this.shouldResetSession(),
      }),
    };

    const result = await this._executeApiCall({
      url: apiUrl,
      fetchOptions,
      extractResponse: (data) =>
        typeof data.response === "string" ? data.response : undefined,
      context: "api-webai-translation",
    });

    this.storeSessionContext({ model: apiModel, lastUsed: Date.now() });
    return result;
  }

  async handleOpenAITranslation(text, sourceLang, targetLang, translateMode) {
    const [apiKey, apiUrl, model] = await Promise.all([
      getOpenAIApiKeyAsync(),
      getOpenAIApiUrlAsync(),
      getOpenAIModelAsync(),
    ]);

    if (!apiKey) {
      const err = new Error(ErrorTypes.API_KEY_MISSING);
      err.type = ErrorTypes.API;
      err.context = "api-openai-apikey";
      throw err;
    }
    if (!apiUrl) {
      const err = new Error(ErrorTypes.API_URL_MISSING);
      err.type = ErrorTypes.API;
      err.context = "api-openai-url";
      throw err;
    }

    const prompt = await buildPrompt(
      text,
      sourceLang,
      targetLang,
      translateMode
    );
    const fetchOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
      }),
    };

    return this._executeApiCall({
      url: apiUrl,
      fetchOptions,
      extractResponse: (data) => data?.choices?.[0]?.message?.content,
      context: "api-openai-translation",
    });
  }

  async handleCustomTranslation(text, sourceLang, targetLang, translateMode) {
    const [apiUrl, apiKey, model] = await Promise.all([
      getCustomApiUrlAsync(),
      getCustomApiKeyAsync(),
      getCustomApiModelAsync(),
    ]);

    if (!apiUrl) {
      const err = new Error(ErrorTypes.API_URL_MISSING);
      err.type = ErrorTypes.API;
      err.context = "api-custom-url";
      throw err;
    }
    if (!apiKey) {
      const err = new Error(ErrorTypes.API_KEY_MISSING);
      err.type = ErrorTypes.API;
      err.context = "api-custom-apikey";
      throw err;
    }

    const prompt = await buildPrompt(
      text,
      sourceLang,
      targetLang,
      translateMode
    );
    const fetchOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model, // مدل باید توسط کاربر مشخص شود
        messages: [{ role: "user", content: prompt }],
      }),
    };

    return this._executeApiCall({
      url: apiUrl,
      fetchOptions,
      extractResponse: (data) => data?.choices?.[0]?.message?.content,
      context: "api-custom-translation",
    });
  }

  async handleOpenRouterTranslation(
    text,
    sourceLang,
    targetLang,
    translateMode
  ) {
    const [apiKey, model] = await Promise.all([
      getOpenRouterApiKeyAsync(),
      getOpenRouterApiModelAsync(),
    ]);

    if (!apiKey) {
      const err = new Error(ErrorTypes.API_KEY_MISSING);
      err.type = ErrorTypes.API;
      err.context = "api-openrouter-apikey";
      throw err;
    }

    const prompt = await buildPrompt(
      text,
      sourceLang,
      targetLang,
      translateMode
    );
    const fetchOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": Browser.runtime.getURL("/"),
        "X-Title": Browser.runtime.getManifest().name,
      },
      body: JSON.stringify({
        model: model || "openai/gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
      }),
    };

    return this._executeApiCall({
      url: CONFIG.OPENROUTER_API_URL,
      fetchOptions,
      extractResponse: (data) => data?.choices?.[0]?.message?.content,
      context: "api-openrouter-translation",
    });
  }

  async handleDeepSeekTranslation(text, sourceLang, targetLang, translateMode) {
    const [apiKey, model] = await Promise.all([
      getDeepSeekApiKeyAsync(),
      getDeepSeekApiModelAsync(),
    ]);

    if (!apiKey) {
      const err = new Error(ErrorTypes.API_KEY_MISSING);
      err.type = ErrorTypes.API;
      err.context = "api-deepseek-apikey";
      throw err;
    }

    const prompt = await buildPrompt(
      text,
      sourceLang,
      targetLang,
      translateMode
    );
    const fetchOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
    };

    return this._executeApiCall({
      url: CONFIG.DEEPSEEK_API_URL,
      fetchOptions,
      extractResponse: (data) => data?.choices?.[0]?.message?.content,
      context: "api-deepseek-translation",
    });
  }

  storeSessionContext(ctx) {
    this.sessionContext = { ...ctx, timestamp: Date.now() };
  }

  resetSessionContext() {
    this.sessionContext = null;
  }

  shouldResetSession() {
    return (
      this.sessionContext && Date.now() - this.sessionContext.lastUsed > 300000
    );
  }

  async translateText(text, translateMode, srcLang, tgtLang) {
    if (await getUseMockAsync()) {
      await delay(MOCK_DELAY);
      const sample = text.substring(0, 50);
      return isPersianText(sample) ?
          CONFIG.DEBUG_TRANSLATED_ENGLISH
        : CONFIG.DEBUG_TRANSLATED_PERSIAN;
    }

    if (!isExtensionContextValid()) {
      const err = new Error(ErrorTypes.CONTEXT);
      err.type = ErrorTypes.CONTEXT;
      err.context = "api-translateText-context";
      throw err;
    }

    let [sourceLang, targetLang] = await Promise.all([
      srcLang || getSourceLanguageAsync(),
      tgtLang || getTargetLanguageAsync(),
    ]);

    if (
      sourceLang === targetLang &&
      translateMode !== TranslationMode.Popup_Translate
    ) {
      return null;
    }

    const api = await getTranslationApiAsync();
    switch (api) {
      case "google":
        return this.handleGoogleTranslate(
          text,
          sourceLang,
          targetLang
        );
      case "gemini":
        return this.handleGeminiTranslation(
          text,
          sourceLang,
          targetLang,
          translateMode
        );
      case "webai":
        return this.handleWebAITranslation(
          text,
          sourceLang,
          targetLang,
          translateMode
        );
      case "openai":
        return this.handleOpenAITranslation(
          text,
          sourceLang,
          targetLang,
          translateMode
        );
      case "openrouter":
        return this.handleOpenRouterTranslation(
          text,
          sourceLang,
          targetLang,
          translateMode
        );
      case "deepseek":
        return this.handleDeepSeekTranslation(
          text,
          sourceLang,
          targetLang,
          translateMode
        );
      case "custom":
        return this.handleCustomTranslation(
          text,
          sourceLang,
          targetLang,
          translateMode
        );
      default: {
        const err = new Error(ErrorTypes.AI_MODEL_MISSING);
        err.type = ErrorTypes.API;
        err.context = "api-translateText-model";
        throw err;
      }
    }
  }
}

const apiService = new ApiService();
export const translateText = apiService.translateText.bind(apiService);
export const API_TEXT_DELIMITER = TEXT_DELIMITER;