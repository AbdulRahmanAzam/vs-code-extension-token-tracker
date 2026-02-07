import * as vscode from 'vscode';
import { ApiClient } from './apiClient';
import { Cache } from './cache';

/**
 * Provides language models through our proxy - makes them available
 * in VS Code's model selector even when not signed into GitHub.
 * 
 * This implements the proposed Language Model API to register custom models.
 */
export class ProxyModelProvider {
  private api: ApiClient;
  private cache: Cache;
  private models: Map<string, vscode.LanguageModelChat> = new Map();

  constructor(api: ApiClient, cache: Cache) {
    this.api = api;
    this.cache = cache;
  }

  /**
   * Register all available proxy models as language models in VS Code.
   * This makes them appear in the model selector.
   */
  async registerModels(context: vscode.ExtensionContext): Promise<void> {
    // Check if API is available (proposed API, might not be in all VS Code versions)
    if (!vscode.lm || typeof (vscode.lm as any).registerChatModelProvider !== 'function') {
      console.log('[TokenTracker] Language Model Provider API not available - models won\'t appear in selector');
      return;
    }

    try {
      // Get available models from proxy
      const status = await this.api.getProxyStatus();
      if (!status.available) {
        console.log('[TokenTracker] Proxy not available - skipping model registration');
        return;
      }

      const proxyModels = await this.api.getProxyModels();
      if (!proxyModels.available || !proxyModels.models || proxyModels.models.length === 0) {
        console.log('[TokenTracker] No proxy models available');
        return;
      }

      // Register each model
      for (const model of proxyModels.models) {
        const modelId = `tokentracker-${model.id}`;
        
        const languageModel: vscode.LanguageModelChat = {
          id: modelId,
          vendor: 'Token Tracker',
          name: model.name,
          family: model.provider,
          version: '1.0',
          maxInputTokens: 100000,
          
          sendRequest: async (
            messages: vscode.LanguageModelChatMessage[],
            options?: vscode.LanguageModelChatRequestOptions,
            token?: vscode.CancellationToken
          ): Promise<vscode.LanguageModelChatResponse> => {
            return this.sendRequest(model.id, messages, options, token);
          },

          countTokens: async (
            text: string | vscode.LanguageModelChatMessage,
            token?: vscode.CancellationToken
          ): Promise<number> => {
            // Rough estimate: 1 token per 4 characters
            const content = typeof text === 'string' ? text : text.content;
            return Math.ceil(content.length / 4);
          },
        };

        // Register with VS Code
        const registerFn = (vscode.lm as any).registerChatModelProvider;
        if (registerFn) {
          const disposable = registerFn(modelId, {
            provideLanguageModelResponse: async (
              messages: vscode.LanguageModelChatMessage[],
              options: any,
              token: vscode.CancellationToken
            ) => {
              return this.sendRequest(model.id, messages, options, token);
            },
          });
          context.subscriptions.push(disposable);
        }

        this.models.set(modelId, languageModel);
        console.log(`[TokenTracker] Registered model: ${model.name} (${modelId})`);
      }
    } catch (err) {
      console.log('[TokenTracker] Failed to register models:', err);
    }
  }

  /**
   * Send a chat request through the proxy
   */
  private async sendRequest(
    modelId: string,
    messages: vscode.LanguageModelChatMessage[],
    options?: vscode.LanguageModelChatRequestOptions,
    token?: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatResponse> {
    // Check if blocked
    const cached = this.cache.load();
    if (cached && (cached.isBlocked || cached.remaining <= 0)) {
      throw new Error('Token limit reached! No remaining tokens this month.');
    }

    // Convert messages to API format
    const apiMessages = messages.map(m => {
      let content = '';
      if (typeof m.content === 'string') {
        content = m.content;
      } else {
        // Handle LanguageModelInputPart[]
        content = m.content.map(part => {
          if ('value' in part) {
            return part.value;
          }
          return '';
        }).join('\n');
      }
      return {
        role: m.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant',
        content,
      };
    });

    try {
      // Non-streaming response for now (streaming can be added later)
      const result = await this.api.proxyChatCompletion(
        apiMessages,
        modelId,
        {
          temperature: (options as any)?.temperature,
          max_tokens: (options as any)?.maxTokens,
        }
      );

      const responseText = result.choices?.[0]?.message?.content || '';

      // Return as a LanguageModelChatResponse
      // Note: This is a simplified implementation - proper streaming would be better
      return {
        stream: (async function* () {
          yield {
            index: 0,
            part: {
              type: 'text' as const,
              value: responseText,
            },
          };
        })(),
      } as any;
    } catch (err: any) {
      throw new Error(`Proxy request failed: ${err?.message || err}`);
    }
  }

  /**
   * Get all registered proxy models
   */
  getModels(): vscode.LanguageModelChat[] {
    return Array.from(this.models.values());
  }
}
