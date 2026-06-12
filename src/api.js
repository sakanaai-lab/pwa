// apiUtils（Phase 1 で app.js から抽出）。挙動は不変。
import { DEEPSEEK_API_BASE_URL, DEFAULT_BEDROCK_MODEL, DEFAULT_BEDROCK_REGION, DEFAULT_MODEL, DEFAULT_OPENROUTER_MODEL, DEFAULT_ZAI_MODEL, GEMINI_API_BASE_URL, INITIAL_RETRY_DELAY, OPENROUTER_API_BASE_URL, ZAI_API_BASE_URL } from './constants.js';
import { appLogic } from './app-logic.js';
import { elements } from './dom-elements.js';
import { interruptibleSleep } from './utils/format.js';
import { state } from './state.js';
import { uiUtils } from './ui.js';

export const apiUtils = {
    // Gemini形式からOpenAI形式への変換
    convertGeminiToOpenAIFormat(messagesForApi) {
        const openAIMessages = [];
        
        for (const geminiMsg of messagesForApi) {
            const role = geminiMsg.role === 'model' ? 'assistant' : (geminiMsg.role === 'tool' ? 'tool' : 'user');
            const parts = geminiMsg.parts || [];
            
            if (role === 'tool') {
                // ツールレスポンスの処理
                for (const part of parts) {
                    if (part.functionResponse) {
                        // OpenAI互換APIの場合、保存されたtool_call_idを使用
                        const toolCallId = part.functionResponse._toolCallId || part.functionResponse.name;
                        openAIMessages.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            content: typeof part.functionResponse.response === 'string' 
                                ? part.functionResponse.response 
                                : JSON.stringify(part.functionResponse.response)
                        });
                    }
                }
            } else {
                const contentParts = [];
                const toolCalls = [];
                
                for (const part of parts) {
                    if (part.text) {
                        contentParts.push({ type: 'text', text: part.text });
                    } else if (part.inlineData) {
                        // 画像データの変換
                        const imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        contentParts.push({
                            type: 'image_url',
                            image_url: { url: imageUrl }
                        });
                    } else if (part.functionCall) {
                        // Function Callingの変換
                        // OpenAI互換APIの場合、保存されたtool_call_idを使用
                        const toolCallId = part.functionCall._toolCallId || `call_${Date.now()}_${Math.random()}`;
                        toolCalls.push({
                            id: toolCallId,
                            type: 'function',
                            function: {
                                name: part.functionCall.name,
                                arguments: typeof part.functionCall.args === 'string' 
                                    ? part.functionCall.args 
                                    : JSON.stringify(part.functionCall.args || {})
                            }
                        });
                    }
                }
                
                const message = { role };
                
                // コンテンツの設定
                if (contentParts.length > 0) {
                    if (contentParts.length === 1 && contentParts[0].type === 'text') {
                        message.content = contentParts[0].text;
                    } else {
                        message.content = contentParts.map(part => {
                            if (part.type === 'text') {
                                return { type: 'text', text: part.text };
                            } else if (part.type === 'image_url') {
                                return part;
                            }
                            return part;
                        });
                    }
                } else if (toolCalls.length > 0) {
                    // tool_callsのみでcontentがない場合は空文字列を設定（Z.ai API互換性のため）
                    message.content = '';
                }
                
                // tool_callsの設定（contentと独立）
                if (toolCalls.length > 0) {
                    message.tool_calls = toolCalls;
                }
                
                if (message.content !== undefined || message.tool_calls) {
                    openAIMessages.push(message);
                }
            }
        }
        
        // デバッグ用にtoolメッセージとassistantメッセージのtool_callsを確認
        const toolMessages = openAIMessages.filter(m => m.role === 'tool');
        const assistantMessagesWithTools = openAIMessages.filter(m => m.role === 'assistant' && m.tool_calls);
        if (toolMessages.length > 0 || assistantMessagesWithTools.length > 0) {
            console.log('[Z.ai Debug] 変換後のメッセージ情報:');
            if (assistantMessagesWithTools.length > 0) {
                console.log(`  - assistant with tool_calls: ${assistantMessagesWithTools.length}件`);
                const lastAssistant = assistantMessagesWithTools[assistantMessagesWithTools.length - 1];
                if (lastAssistant && lastAssistant.tool_calls) {
                    console.log(`  - 最後のassistantのtool_call IDs:`, JSON.stringify(lastAssistant.tool_calls.map(tc => tc.id)));
                }
            }
            if (toolMessages.length > 0) {
                console.log(`  - tool messages: ${toolMessages.length}件`);
                const recentToolIds = toolMessages.slice(-5).map(m => m.tool_call_id);
                console.log(`  - 最近のtool_call_ids:`, JSON.stringify(recentToolIds));
            }
            // IDの一致を確認
            if (assistantMessagesWithTools.length > 0 && toolMessages.length > 0) {
                const lastAssistant = assistantMessagesWithTools[assistantMessagesWithTools.length - 1];
                const expectedIds = lastAssistant.tool_calls?.map(tc => tc.id) || [];
                const actualIds = toolMessages.slice(-expectedIds.length).map(tm => tm.tool_call_id);
                const matched = expectedIds.every((id, i) => id === actualIds[i]);
                console.log(`  - ID一致チェック: ${matched ? '✓ 一致' : '✗ 不一致'}`);
                if (!matched) {
                    console.warn(`  - 期待されるIDs: ${JSON.stringify(expectedIds)}`);
                    console.warn(`  - 実際のIDs: ${JSON.stringify(actualIds)}`);
                }
            }
        }
        
        return openAIMessages;
    },

    // OpenAI形式からGemini形式への変換（レスポンス用）
    convertOpenAIToGeminiFormat(openAIResponse) {
        // OpenAI形式のレスポンスをGemini形式に変換
        const candidates = [];

        if (openAIResponse.choices && openAIResponse.choices.length > 0) {
            for (const choice of openAIResponse.choices) {
                const parts = [];
                const message = choice.message;

                // reasoning_content (DeepSeek-R1等) を思考プロセスとして追加
                if (message.reasoning_content) {
                    parts.push({ text: message.reasoning_content, thought: true });
                }

                if (message.content) {
                    if (typeof message.content === 'string') {
                        // <think>タグで囲まれた思考プロセスを分離
                        const thinkMatch = message.content.match(/^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/);
                        if (thinkMatch) {
                            if (thinkMatch[1].trim()) parts.push({ text: thinkMatch[1].trim(), thought: true });
                            if (thinkMatch[2].trim()) parts.push({ text: thinkMatch[2].trim() });
                        } else {
                            parts.push({ text: message.content });
                        }
                    } else if (Array.isArray(message.content)) {
                        for (const contentItem of message.content) {
                            if (contentItem.type === 'text') {
                                parts.push({ text: contentItem.text });
                            } else if (contentItem.type === 'image_url') {
                                // 画像URLからbase64データを抽出（必要に応じて）
                                // 現時点ではテキストのみ対応
                            }
                        }
                    }
                }
                
                if (message.tool_calls && message.tool_calls.length > 0) {
                    for (const toolCall of message.tool_calls) {
                        const callArgs = toolCall?.function?.arguments;
                        const parsedArgs = this._parseToolArguments(callArgs);
                        parts.push({
                            functionCall: {
                                name: toolCall.function.name,
                                args: parsedArgs,
                                _toolCallId: toolCall.id  // OpenAI互換APIのtool_call_idを保存
                            }
                        });
                    }
                }
                
                if (parts.length > 0) {
                    candidates.push({
                        content: { parts },
                        finishReason: this.mapFinishReason(choice.finish_reason),
                        index: choice.index
                    });
                }
            }
        }
        
        // usageMetadataの変換
        const usageMetadata = openAIResponse.usage ? {
            promptTokenCount: openAIResponse.usage.prompt_tokens,
            candidatesTokenCount: openAIResponse.usage.completion_tokens,
            totalTokenCount: openAIResponse.usage.total_tokens
        } : undefined;
        
        return {
            candidates,
            usageMetadata
        };
    },

    // OpenAIのfinish_reasonをGeminiのfinishReasonにマッピング
    mapFinishReason(openAIFinishReason) {
        const mapping = {
            'stop': 'STOP',
            'length': 'MAX_TOKENS',
            'tool_calls': 'STOP',
            'content_filter': 'SAFETY',
            'function_call': 'STOP'
        };
        return mapping[openAIFinishReason] || 'STOP';
    },

    /**
     * OpenAI形式のtool argumentsを安全にオブジェクトへ変換する
     * - 文字列(JSON)形式
     * - 文字列だが各値がクォートされていない簡易オブジェクト形式
     * - 既にオブジェクト
     * に対応する。
     * 解析に失敗した場合は { raw: ... } を返す。
     */
    _parseToolArguments(callArgs) {
        if (!callArgs) {
            return {};
        }

        if (typeof callArgs === 'object') {
            return callArgs;
        }

        if (typeof callArgs !== 'string') {
            return {};
        }

        const trimmed = callArgs.trim();
        if (!trimmed) {
            return {};
        }

        // 1st attempt: JSON.parse as-is
        try {
            return JSON.parse(trimmed);
        } catch (firstError) {
            // 2nd attempt: 正規化してからJSON.parse
            try {
                const normalized = trimmed
                    // 値がクォートされていないケースを検出してクォートを付与
                    .replace(/:\s*([^"{\[\],}]+)(?=\s*[},])/g, (_match, value) => {
                        const v = value.trim();
                        if (!v) return ': ""';
                        const lower = v.toLowerCase();
                        if (lower === 'true' || lower === 'false' || lower === 'null') {
                            return `: ${lower}`;
                        }
                        if (/^-?\d+(\.\d+)?$/.test(v)) {
                            return `: ${v}`;
                        }
                        const escaped = v.replace(/"/g, '\\"');
                        return `: "${escaped}"`;
                    });

                return JSON.parse(normalized);
            } catch (secondError) {
                console.warn('convertOpenAIToGeminiFormat: argumentsの解析に失敗しました。生文字列を保持します。', secondError);
                return { raw: trimmed };
            }
        }
    },

    // Gemini形式からBedrock Converse形式への変換
    convertGeminiToConverseFormat(messagesForApi) {
        const converseMessages = [];
        let pendingToolResults = [];  // 連続するtoolメッセージを一時保存
        
        for (let i = 0; i < messagesForApi.length; i++) {
            const geminiMsg = messagesForApi[i];
            
            // まずロールを判定（デフォルト）
            let role = geminiMsg.role === 'model' ? 'assistant' : geminiMsg.role;
            const content = [];
            
            // functionResponseが含まれているかチェック
            let hasFunctionResponse = false;
            
            if (geminiMsg.parts) {
                for (const part of geminiMsg.parts) {
                    if (part.text) {
                        content.push({ text: part.text });
                    } else if (part.inlineData) {
                        // Base64画像データをバイナリに変換
                        const base64Data = part.inlineData.data;
                        const format = part.inlineData.mimeType.split('/')[1];
                        content.push({
                            image: {
                                format: format,
                                source: { 
                                    bytes: Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
                                }
                            }
                        });
                    } else if (part.functionCall) {
                        // Tool use形式に変換
                        content.push({
                            toolUse: {
                                toolUseId: part.functionCall._toolCallId || `tool_${Date.now()}_${Math.random()}`,
                                name: part.functionCall.name,
                                input: part.functionCall.args || {}
                            }
                        });
                    } else if (part.functionResponse) {
                        // Tool result形式に変換
                        hasFunctionResponse = true;
                        const responseContent = typeof part.functionResponse.response === 'string' 
                            ? part.functionResponse.response 
                            : JSON.stringify(part.functionResponse.response);
                        
                        // toolUseIdは元のtoolCallIdを使用（なければ関数名をフォールバック）
                        const toolUseId = part.functionResponse._toolCallId || part.functionResponse.name;
                        
                        content.push({
                            toolResult: {
                                toolUseId: toolUseId,
                                content: [{ text: responseContent }]
                            }
                        });
                    }
                }
            }
            
            // role: "tool" の場合は、連続するtoolメッセージを集める
            if (geminiMsg.role === 'tool' || hasFunctionResponse) {
                pendingToolResults.push(...content);
                
                // 次のメッセージがtool以外の場合、または最後のメッセージの場合
                const nextMsg = messagesForApi[i + 1];
                const isLastMessage = i === messagesForApi.length - 1;
                const nextIsNotTool = !nextMsg || (nextMsg.role !== 'tool' && !nextMsg.parts?.some(p => p.functionResponse));
                
                if (isLastMessage || nextIsNotTool) {
                    // 溜まっているtoolResultsを1つの"user"メッセージとして追加
                    if (pendingToolResults.length > 0) {
                        converseMessages.push({
                            role: 'user',
                            content: pendingToolResults
                        });
                        pendingToolResults = [];
                    }
                }
            } else {
                // tool以外のメッセージはそのまま追加
                if (content.length > 0) {
                    converseMessages.push({ role, content });
                }
            }
        }
        
        return converseMessages;
    },

    // Bedrock Converse形式からGemini形式への変換
    convertConverseToGeminiFormat(converseResponse) {
        const parts = [];
        
        if (converseResponse.output && converseResponse.output.message) {
            const message = converseResponse.output.message;
            
            for (const contentItem of message.content || []) {
                if (contentItem.text) {
                    parts.push({ text: contentItem.text });
                } else if (contentItem.toolUse) {
                    parts.push({
                        functionCall: {
                            name: contentItem.toolUse.name,
                            args: contentItem.toolUse.input || {},
                            _toolCallId: contentItem.toolUse.toolUseId
                        }
                    });
                }
            }
        }
        
        // finishReasonのマッピング
        let finishReason = 'STOP';
        if (converseResponse.stopReason) {
            const reasonMap = {
                'end_turn': 'STOP',
                'tool_use': 'STOP',
                'max_tokens': 'MAX_TOKENS',
                'stop_sequence': 'STOP',
                'content_filtered': 'SAFETY'
            };
            finishReason = reasonMap[converseResponse.stopReason] || 'STOP';
        }
        
        return {
            candidates: [{
                content: {
                    parts: parts,
                    role: 'model'
                },
                finishReason: finishReason
            }],
            usageMetadata: {
                promptTokenCount: converseResponse.usage?.inputTokens || 0,
                candidatesTokenCount: converseResponse.usage?.outputTokens || 0,
                totalTokenCount: (converseResponse.usage?.inputTokens || 0) + (converseResponse.usage?.outputTokens || 0)
            }
        };
    },

    // Gemini形式のFunction DeclarationsをBedrock形式に変換
    convertGeminiToolsToBedrock(geminiTools) {
        // JSON Schemaの型名を小文字に変換する再帰関数
        const normalizeJsonSchema = (schema) => {
            if (!schema || typeof schema !== 'object') {
                return schema;
            }

            const normalized = Array.isArray(schema) ? [] : {};

            for (const key in schema) {
                if (!schema.hasOwnProperty(key)) continue;

                let value = schema[key];

                // "type"フィールドの値を小文字に変換
                if (key === 'type' && typeof value === 'string') {
                    value = value.toLowerCase();
                }
                // オブジェクトまたは配列の場合は再帰処理
                else if (typeof value === 'object' && value !== null) {
                    value = normalizeJsonSchema(value);
                }

                normalized[key] = value;
            }

            return normalized;
        };

        const bedrockTools = [];
        
        for (const geminiTool of geminiTools) {
            if (geminiTool.function_declarations && Array.isArray(geminiTool.function_declarations)) {
                for (const funcDecl of geminiTool.function_declarations) {
                    // parametersを正規化（型名を小文字に変換）
                    const normalizedParameters = normalizeJsonSchema(funcDecl.parameters || {});
                    
                    bedrockTools.push({
                        toolSpec: {
                            name: funcDecl.name,
                            description: funcDecl.description || '',
                            inputSchema: {
                                json: normalizedParameters
                            }
                        }
                    });
                }
            }
        }
        
        return bedrockTools;
    },

    // Gemini APIを呼び出す
    async callGeminiApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        console.log(`[Debug] callGeminiApi: 現在の設定値を確認します。`, {
            forceFunctionCalling: state.settings.forceFunctionCalling,
            geminiEnableFunctionCalling: state.settings.geminiEnableFunctionCalling,
            isForcedNow: forceCalling
        });

        const apiKey = state.settings.apiKey;
        if (!apiKey) {
            throw new Error("Gemini APIキーが設定されていません。");
        }
        
        // signalが渡されていない場合のみstate.abortControllerを作成
        if (!signal) {
            state.abortController = new AbortController();
            signal = state.abortController.signal;
        }

        const model = state.settings.modelName || DEFAULT_MODEL;

        if (model === 'gemini-2.5-pro') {
            await appLogic._updateApiUsageCount(state.activeProfileId); 
        }

        const isImageGenModel = model === 'gemini-2.5-flash-image-preview' ||
            model.includes('image-generation') || model.includes('imagen');

        const endpointMethod = 'generateContent?';

        const endpoint = `${GEMINI_API_BASE_URL}${model}:${endpointMethod}key=${apiKey}`;
        
        const finalGenerationConfig = { ...generationConfig };
        
        if (isImageGenModel) {
            finalGenerationConfig.responseModalities = ['IMAGE', 'TEXT'];
            delete finalGenerationConfig.thinkingConfig;

            delete finalGenerationConfig.maxOutputTokens;
            delete finalGenerationConfig.topK;
            delete finalGenerationConfig.topP;
            delete finalGenerationConfig.temperature;

        } else {
            if ((state.settings.thinkingBudget > 0) || state.settings.includeThoughts) {
                generationConfig.thinkingConfig = {};
                if(state.settings.thinkingBudget > 0) generationConfig.thinkingConfig.thinkingBudget = state.settings.thinkingBudget;
                if(state.settings.includeThoughts) generationConfig.thinkingConfig.includeThoughts = true;
            }
        }

        const requestBody = {
            contents: messagesForApi,
            ...(Object.keys(finalGenerationConfig).length > 0 && { generationConfig: finalGenerationConfig }),
            safetySettings : [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
        };

        if (isImageGenModel) {
            requestBody.safetySettings = [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ];
        } else {
            if (systemInstruction && systemInstruction.parts && systemInstruction.parts.length > 0 && systemInstruction.parts[0].text) {
                const { _staticText, _dynamicText, ...cleanSystemInstruction } = systemInstruction;
                requestBody.systemInstruction = cleanSystemInstruction;
            }

            let finalTools = [];
            if (state.settings.geminiEnableFunctionCalling) {
                finalTools = window.functionDeclarations || [];
                console.log("Function Calling を有効にしてAPIを呼び出します。");
            } 
            else if (state.settings.geminiEnableGrounding) {
                finalTools.push({ "google_search": {} });
                console.log("グラウンディング (Google Search) を有効にしてAPIを呼び出します。");
            }
            
            if (finalTools.length > 0) {
                requestBody.tools = finalTools;
            }

            if (forceCalling && state.settings.geminiEnableFunctionCalling) {
                requestBody.toolConfig = {
                    functionCallingConfig: {
                        mode: 'ANY'
                    }
                };
                console.log("Function Calling を強制モード (ANY) で実行します。");
            }
        }

        console.log("Geminiへの送信データ:", JSON.stringify(requestBody, (key, value) => {
            if (key === 'data' && typeof value === 'string' && value.length > 100) {
                return value.substring(0, 50) + '...[省略]...' + value.substring(value.length - 20);
            }
            return value;
        }, 2));
        console.log("ターゲットエンドポイント:", endpoint);

        try {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${timestamp}] Sending fetch request to Gemini API...`);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(requestBody),
                signal
            });

            const receivedTimestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${receivedTimestamp}] Received response from Gemini API. Status: ${response.status}`);

            if (!response.ok) {
                let errorMsg = `APIエラー (${response.status}): ${response.statusText}`;
                let errorData = null;
                try {
                    errorData = await response.json();
                    console.error("APIエラーレスポンスボディ:", errorData);
                    if (errorData.error && errorData.error.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.error.message}`;
                    }
                } catch (e) {
                    console.error("APIエラーレスポンスボディのパース失敗:", e);
                }
                const error = new Error(errorMsg);
                error.status = response.status;
                error.data = errorData;
                throw error;
            }
            return response;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error("リクエストがキャンセルされました。");
            } else {
                throw error;
            }
        }
    },


    /**
     * テキストを日本語に翻訳する関数
     * @param {string} textToTranslate - 翻訳対象の英語テキスト
     * @param {string} translationModelName - 翻訳に使用するモデル名
     * @returns {Promise<string>} 翻訳された日本語テキスト。失敗した場合は元の英語テキストを返す。
     */
     async translateText(textToTranslate, translationModelName) {
        if (!textToTranslate || textToTranslate.trim() === '') {
            return textToTranslate;
        }

        const japaneseChars = textToTranslate.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g) || [];
        const japaneseRatio = japaneseChars.length / textToTranslate.length;

        if (japaneseRatio > 0.5) {
            console.log(`翻訳スキップ: 日本語の文字が${Math.round(japaneseRatio * 100)}%含まれているため、翻訳済みと判断しました。`);
            return textToTranslate;
        }

        console.log("--- 思考プロセスの翻訳処理開始 ---");
        
        const modelToUse = translationModelName || 'gemini-2.5-flash-lite';
        const isDeepSeek = modelToUse.startsWith('deepseek-');
        const translationSystemPrompt = "You are a professional translator. Translate the given English text into natural Japanese. Do not add any extra comments or explanations. Just output the translated Japanese text.";

        let endpoint, requestBody, fetchHeaders;

        if (isDeepSeek) {
            const deepseekApiKey = state.settings.deepseekApiKey;
            if (!deepseekApiKey) {
                console.warn("翻訳スキップ: DeepSeek APIキーが設定されていません。");
                return textToTranslate;
            }
            endpoint = DEEPSEEK_API_BASE_URL;
            fetchHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekApiKey}` };
            requestBody = {
                model: modelToUse,
                messages: [
                    { role: 'system', content: translationSystemPrompt },
                    { role: 'user', content: textToTranslate }
                ],
                temperature: 0.1,
            };
        } else {
            const apiKey = state.settings.apiKey;
            if (!apiKey) {
                console.warn("翻訳スキップ: APIキーが設定されていません。");
                return textToTranslate;
            }
            endpoint = `${GEMINI_API_BASE_URL}${modelToUse}:generateContent`;
            fetchHeaders = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
            requestBody = {
                contents: [{ role: 'user', parts: [{ text: textToTranslate }] }],
                systemInstruction: { parts: [{ text: translationSystemPrompt }] },
                generationConfig: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } },
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                ]
            };
        }

        if (state.settings.dummyEnabled && state.settings.applyDummyToTranslate && state.settings.dummyUser) {
            requestBody.contents.push({
                role: 'user',
                parts: [{ text: state.settings.dummyUser }]
            });
            console.log("翻訳リクエストにダミーUserプロンプトを適用しました。");
        }

        let lastError = null;
        const maxTranslationRetries = state.settings.enableAutoRetry ? state.settings.maxRetries : 0;

        for (let attempt = 0; attempt <= maxTranslationRetries; attempt++) {
            try {
                if (state.abortController?.signal.aborted) {
                    throw new Error("リクエストがキャンセルされました。");
                }

                if (attempt > 0) {
                    let delay;
                    if (state.settings.useFixedRetryDelay) {
                        delay = state.settings.fixedRetryDelaySeconds * 1000;
                    } else {
                        const exponentialDelay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
                        const maxDelay = state.settings.maxBackoffDelaySeconds * 1000;
                        delay = Math.min(exponentialDelay, maxDelay);
                    }
                    uiUtils.setLoadingIndicatorText(`翻訳エラー 再試行(${attempt}回目)... ${Math.round(delay/1000)}秒待機`);
                    console.log(`翻訳APIリトライ ${attempt}: ${delay}ms待機...`);
                    await interruptibleSleep(delay, state.abortController.signal);
                }

                if (attempt > 0) {
                    uiUtils.setLoadingIndicatorText('思考プロセスの翻訳を再試行中...');
                } else {
                    uiUtils.setLoadingIndicatorText('思考プロセスを翻訳中...');
                }

                const timeoutController = new AbortController();
                const timeoutId = setTimeout(() => timeoutController.abort(), 15000);

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: JSON.stringify(requestBody),
                    signal: timeoutController.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    let errorBody = await response.text();
                    try { errorBody = JSON.parse(errorBody); } catch(e) { /* ignore */ }
                    console.error(`翻訳APIエラー (${response.status})`, errorBody);
                    const error = new Error(`翻訳APIエラー (${response.status})`);
                    error.status = response.status;
                    throw error;
                }

                const responseData = await response.json();
                // DeepSeek (OpenAI互換) とGeminiでレスポンス形式が異なる
                const translatedText = isDeepSeek
                    ? responseData.choices?.[0]?.message?.content
                    : responseData.candidates?.[0]?.content?.parts?.find(p => !p.thought && p.text)?.text;
                if (translatedText) {
                    console.log("--- 翻訳処理成功 ---");
                    return translatedText;
                } else {
                    console.warn("翻訳APIの応答形式が不正、またはコンテンツが空です。", responseData);
                    if(responseData.promptFeedback) {
                        console.warn("翻訳がブロックされた可能性があります:", responseData.promptFeedback);
                    }
                    throw new Error("翻訳APIの応答形式が不正です。");
                }
            } catch (error) {
                lastError = error;
                if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                    if (state.abortController?.signal.aborted) {
                        break;
                    }
                }
                if (error.status && error.status >= 400 && error.status < 500) {
                    console.error(`リトライ不可の翻訳エラー (ステータス: ${error.status})。`);
                    break;
                }
                console.warn(`翻訳API呼び出し試行 ${attempt + 1} が失敗。`, error);
            }
        }

        console.error("思考プロセスの翻訳中にエラーが発生しました。原文を返します。", lastError);
        return textToTranslate;
    },

    // Z.ai APIを呼び出す
    async callZaiApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        console.log(`[Debug] callZaiApi: Z.ai APIを呼び出します。`);

        const apiKey = state.settings.zaiApiKey || state.settings.apiKey;
        if (!apiKey) {
            throw new Error("Z.ai APIキーが設定されていません。");
        }

        // signalが渡されていない場合のみstate.abortControllerを作成
        if (!signal) {
            state.abortController = new AbortController();
            signal = state.abortController.signal;
        }

        const model = state.settings.modelName || DEFAULT_ZAI_MODEL;

        // Gemini形式のメッセージをOpenAI形式に変換
        const openAIMessages = this.convertGeminiToOpenAIFormat(messagesForApi);

        // システムプロンプトの処理
        if (systemInstruction && systemInstruction.parts && systemInstruction.parts.length > 0) {
            const systemText = systemInstruction.parts[0].text;
            if (systemText) {
                // システムメッセージを先頭に追加
                openAIMessages.unshift({
                    role: 'system',
                    content: systemText
                });
            }
        }

        // リクエストボディの構築
        const requestBody = {
            model: model,
            messages: openAIMessages
        };

        // 生成パラメータの変換
        if (generationConfig) {
            if (generationConfig.temperature !== undefined) {
                requestBody.temperature = generationConfig.temperature;
            }
            if (generationConfig.maxOutputTokens !== undefined) {
                requestBody.max_tokens = generationConfig.maxOutputTokens;
            }
            if (generationConfig.topP !== undefined) {
                requestBody.top_p = generationConfig.topP;
            }
            // Z.ai APIではtop_kはサポートされていない可能性があるため、変換しない
        }

        // Function Callingの処理
        if (state.settings.geminiEnableFunctionCalling && window.functionDeclarations) {
            // Gemini形式のfunction declarationsをOpenAI形式に変換
            const openAITools = [];
            
            for (const geminiTool of window.functionDeclarations) {
                if (geminiTool.function_declarations && Array.isArray(geminiTool.function_declarations)) {
                    // Gemini形式: { function_declarations: [{ name, description, parameters }] }
                    for (const funcDecl of geminiTool.function_declarations) {
                        openAITools.push({
                            type: 'function',
                            function: {
                                name: funcDecl.name,
                                description: funcDecl.description || '',
                                parameters: funcDecl.parameters || {}
                            }
                        });
                    }
                } else if (geminiTool.google_search) {
                    // Google SearchはZ.aiではサポートされていない可能性があるためスキップ
                    console.warn("Z.ai APIではGoogle Searchはサポートされていません。スキップします。");
                }
            }

            if (openAITools.length > 0) {
                requestBody.tools = openAITools;
                if (forceCalling) {
                    requestBody.tool_choice = 'required';
                } else {
                    requestBody.tool_choice = 'auto';
                }
                console.log(`Z.ai APIに ${openAITools.length} 個のFunction Callingツールを設定しました。`);
            }
        }

        console.log("Z.aiへの送信データ:", JSON.stringify(requestBody, (key, value) => {
            if (key === 'data' && typeof value === 'string' && value.length > 100) {
                return value.substring(0, 50) + '...[省略]...' + value.substring(value.length - 20);
            }
            return value;
        }, 2));
        
        // メッセージ構造の詳細をログ出力（デバッグ用）
        if (requestBody.messages && requestBody.messages.length > 0) {
            const recentMessages = requestBody.messages.slice(-6);
            console.log('[Z.ai Debug] 送信する最近のメッセージ構造:');
            recentMessages.forEach((msg, idx) => {
                const info = { role: msg.role };
                if (msg.tool_calls) {
                    info.tool_calls = msg.tool_calls.map(tc => ({ id: tc.id, name: tc.function?.name }));
                }
                if (msg.tool_call_id) {
                    info.tool_call_id = msg.tool_call_id;
                }
                // contentの存在を常に表示（空文字列でも）
                if ('content' in msg) {
                    if (typeof msg.content === 'string') {
                        if (msg.content === '') {
                            info.content = '""'; // 空文字列を明示
                        } else {
                            info.content_preview = msg.content.substring(0, 50) + '...';
                        }
                    } else {
                        info.content_type = typeof msg.content;
                    }
                } else {
                    info.no_content_field = true;
                }
                console.log(`  [${idx}]`, JSON.stringify(info));
            });
        }
        
        console.log("ターゲットエンドポイント:", ZAI_API_BASE_URL);

        try {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${timestamp}] Sending fetch request to Z.ai API...`);

            const response = await fetch(ZAI_API_BASE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody),
                signal
            });

            const receivedTimestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${receivedTimestamp}] Received response from Z.ai API. Status: ${response.status}`);

            if (!response.ok) {
                let errorMsg = `APIエラー (${response.status}): ${response.statusText}`;
                let errorData = null;
                try {
                    errorData = await response.json();
                    console.error("APIエラーレスポンスボディ:", errorData);
                    if (errorData.error && errorData.error.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.error.message}`;
                    } else if (errorData.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.message}`;
                    }
                } catch (e) {
                    console.error("APIエラーレスポンスボディのパース失敗:", e);
                }
                const error = new Error(errorMsg);
                error.status = response.status;
                error.data = errorData;
                throw error;
            }

            // レスポンスを取得してGemini形式に変換
            const openAIResponse = await response.json();
            
            // デバッグ用：Z.ai APIからのレスポンス構造を確認
            if (openAIResponse.choices && openAIResponse.choices[0]) {
                const choice = openAIResponse.choices[0];
                console.log('[Z.ai Debug] APIレスポンス情報:');
                console.log(`  - finish_reason: ${choice.finish_reason}`);
                if (choice.message) {
                    if (choice.message.tool_calls) {
                        console.log(`  - tool_calls数: ${choice.message.tool_calls.length}`);
                        choice.message.tool_calls.forEach((tc, idx) => {
                            console.log(`    [${idx}] id: ${tc.id}, name: ${tc.function?.name}`);
                        });
                    }
                    if (choice.message.content) {
                        console.log(`  - content: ${choice.message.content.substring(0, 50)}...`);
                    }
                }
            }
            
            const geminiFormatResponse = this.convertOpenAIToGeminiFormat(openAIResponse);

            // Responseオブジェクトのように扱えるようにラップ
            return {
                ok: true,
                status: response.status,
                json: async () => geminiFormatResponse
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error("リクエストがキャンセルされました。");
            } else {
                throw error;
            }
        }
    },

    // OpenRouter APIを呼び出す
    async callOpenRouterApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        console.log(`[Debug] callOpenRouterApi: OpenRouter APIを呼び出します。`);

        const apiKey = state.settings.openrouterApiKey;
        if (!apiKey) {
            throw new Error("OpenRouter APIキーが設定されていません。");
        }

        // signalが渡されていない場合のみstate.abortControllerを作成
        if (!signal) {
            state.abortController = new AbortController();
            signal = state.abortController.signal;
        }

        const model = state.settings.modelName || DEFAULT_OPENROUTER_MODEL;

        // Gemini形式のメッセージをOpenAI形式に変換
        const openAIMessages = this.convertGeminiToOpenAIFormat(messagesForApi);

        // システムプロンプトの処理
        if (systemInstruction && systemInstruction.parts && systemInstruction.parts.length > 0) {
            const systemText = systemInstruction.parts[0].text;
            if (systemText) {
                // システムメッセージを先頭に追加
                openAIMessages.unshift({
                    role: 'system',
                    content: systemText
                });
            }
        }

        // リクエストボディの構築
        const requestBody = {
            model: model,
            messages: openAIMessages
        };

        // 生成パラメータの変換
        if (generationConfig) {
            if (generationConfig.temperature !== undefined) {
                requestBody.temperature = generationConfig.temperature;
            }
            if (generationConfig.maxOutputTokens !== undefined) {
                requestBody.max_tokens = generationConfig.maxOutputTokens;
            }
            if (generationConfig.topP !== undefined) {
                requestBody.top_p = generationConfig.topP;
            }
        }

        // Function Callingの処理
        if (state.settings.geminiEnableFunctionCalling && window.functionDeclarations) {
            // Gemini形式のfunction declarationsをOpenAI形式に変換
            const openAITools = [];
            
            for (const geminiTool of window.functionDeclarations) {
                if (geminiTool.function_declarations && Array.isArray(geminiTool.function_declarations)) {
                    // Gemini形式: { function_declarations: [{ name, description, parameters }] }
                    for (const funcDecl of geminiTool.function_declarations) {
                        openAITools.push({
                            type: 'function',
                            function: {
                                name: funcDecl.name,
                                description: funcDecl.description || '',
                                parameters: funcDecl.parameters || {}
                            }
                        });
                    }
                } else if (geminiTool.google_search) {
                    // Google SearchはOpenRouterではサポートされていない可能性があるためスキップ
                    console.warn("OpenRouter APIではGoogle Searchはサポートされていません。スキップします。");
                }
            }

            if (openAITools.length > 0) {
                requestBody.tools = openAITools;
                if (forceCalling) {
                    requestBody.tool_choice = 'required';
                } else {
                    requestBody.tool_choice = 'auto';
                }
                console.log(`OpenRouter APIに ${openAITools.length} 個のFunction Callingツールを設定しました。`);
            }
        }

        console.log("OpenRouterへの送信データ:", JSON.stringify(requestBody, (key, value) => {
            if (key === 'data' && typeof value === 'string' && value.length > 100) {
                return value.substring(0, 50) + '...[省略]...' + value.substring(value.length - 20);
            }
            return value;
        }, 2));
        
        // メッセージ構造の詳細をログ出力（デバッグ用）
        if (requestBody.messages && requestBody.messages.length > 0) {
            const recentMessages = requestBody.messages.slice(-6);
            console.log('[OpenRouter Debug] 送信する最近のメッセージ構造:');
            recentMessages.forEach((msg, idx) => {
                const info = { role: msg.role };
                if (msg.tool_calls) {
                    info.tool_calls = msg.tool_calls.map(tc => ({ id: tc.id, name: tc.function?.name }));
                }
                if (msg.tool_call_id) {
                    info.tool_call_id = msg.tool_call_id;
                }
                // contentの存在を常に表示（空文字列でも）
                if ('content' in msg) {
                    if (typeof msg.content === 'string') {
                        if (msg.content === '') {
                            info.content = '""'; // 空文字列を明示
                        } else {
                            info.content_preview = msg.content.substring(0, 50) + '...';
                        }
                    } else {
                        info.content_type = typeof msg.content;
                    }
                } else {
                    info.no_content_field = true;
                }
                console.log(`  [${idx}]`, JSON.stringify(info));
            });
        }
        
        console.log("ターゲットエンドポイント:", OPENROUTER_API_BASE_URL);

        try {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${timestamp}] Sending fetch request to OpenRouter API...`);

            const response = await fetch(OPENROUTER_API_BASE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'Aquarium Chat'
                },
                body: JSON.stringify(requestBody),
                signal
            });

            const receivedTimestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${receivedTimestamp}] Received response from OpenRouter API. Status: ${response.status}`);

            if (!response.ok) {
                let errorMsg = `APIエラー (${response.status}): ${response.statusText}`;
                let errorData = null;
                try {
                    errorData = await response.json();
                    console.error("APIエラーレスポンスボディ:", errorData);
                    
                    // 詳細なエラー情報をログ出力
                    if (errorData.error) {
                        console.error("[OpenRouter] エラー詳細:", JSON.stringify(errorData.error, null, 2));
                        if (errorData.error.metadata) {
                            console.error("[OpenRouter] メタデータ:", errorData.error.metadata);
                        }
                        if (errorData.error.code) {
                            console.error("[OpenRouter] エラーコード:", errorData.error.code);
                        }
                    }
                    
                    if (errorData.error && errorData.error.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.error.message}`;
                        // OpenRouter特有の追加情報があれば追加
                        if (errorData.error.code) {
                            errorMsg += ` (code: ${errorData.error.code})`;
                        }
                    } else if (errorData.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.message}`;
                    }
                } catch (e) {
                    console.error("APIエラーレスポンスボディのパース失敗:", e);
                }
                const error = new Error(errorMsg);
                error.status = response.status;
                error.data = errorData;
                throw error;
            }

            // レスポンスを取得してGemini形式に変換
            const openAIResponse = await response.json();
            
            // デバッグ用：OpenRouter APIからのレスポンス構造を確認
            if (openAIResponse.choices && openAIResponse.choices[0]) {
                const choice = openAIResponse.choices[0];
                console.log('[OpenRouter Debug] APIレスポンス情報:');
                console.log(`  - finish_reason: ${choice.finish_reason}`);
                if (choice.message) {
                    if (choice.message.tool_calls) {
                        console.log(`  - tool_calls数: ${choice.message.tool_calls.length}`);
                        choice.message.tool_calls.forEach((tc, idx) => {
                            console.log(`    [${idx}] id: ${tc.id}, name: ${tc.function?.name}`);
                        });
                    }
                    if (choice.message.content) {
                        console.log(`  - content: ${choice.message.content.substring(0, 50)}...`);
                    }
                }
            }
            
            const geminiFormatResponse = this.convertOpenAIToGeminiFormat(openAIResponse);

            // Responseオブジェクトのように扱えるようにラップ
            return {
                ok: true,
                status: response.status,
                json: async () => geminiFormatResponse
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error("リクエストがキャンセルされました。");
            } else {
                throw error;
            }
        }
    },

    // Amazon Bedrock APIを呼び出す
    async callBedrockApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        console.log(`[Debug] callBedrockApi: Amazon Bedrock APIを呼び出します。`);
        
        const accessKey = state.settings.bedrockAccessKey;
        const secretKey = state.settings.bedrockSecretKey;
        const region = state.settings.bedrockRegion || DEFAULT_BEDROCK_REGION;
        
        // デバッグ情報を出力
        console.log(`[Bedrock Debug] Access Key存在: ${!!accessKey}, Secret Key存在: ${!!secretKey}, Region: ${region}`);
        console.log(`[Bedrock Debug] state.settings:`, {
            bedrockAccessKey: accessKey ? `${accessKey.substring(0, 8)}...` : 'なし',
            bedrockSecretKey: secretKey ? '設定済み' : 'なし',
            bedrockRegion: region
        });
        
        if (!accessKey || !secretKey) {
            console.error('[Bedrock Debug] 認証情報が不足しています。elements確認:', {
                bedrockAccessKeyInput: elements.bedrockAccessKeyInput,
                bedrockSecretKeyInput: elements.bedrockSecretKeyInput,
                bedrockAccessKeyValue: elements.bedrockAccessKeyInput?.value,
                bedrockSecretKeyValue: elements.bedrockSecretKeyInput ? '存在する' : 'なし'
            });
            throw new Error("Bedrock認証情報（Access KeyまたはSecret Key）が設定されていません。");
        }

        // AWS SDK が読み込まれているか確認
        if (!window.BedrockRuntimeClient || !window.ConverseCommand) {
            throw new Error("AWS Bedrock SDK が読み込まれていません。ページを再読み込みしてください。");
        }

        // signalが渡されていない場合のみstate.abortControllerを作成
        if (!signal) {
            state.abortController = new AbortController();
            signal = state.abortController.signal;
        }

        const modelId = state.settings.modelName || DEFAULT_BEDROCK_MODEL;

        try {
            // BedrockRuntimeClientの初期化
            const client = new window.BedrockRuntimeClient({
                region: region,
                credentials: {
                    accessKeyId: accessKey,
                    secretAccessKey: secretKey
                }
            });

            // Gemini形式からBedrock Converse形式へ変換
            const converseMessages = this.convertGeminiToConverseFormat(messagesForApi);
            
            // デバッグ: 変換後のメッセージ数とtoolResult数を確認
            console.log(`[Bedrock] 変換後のメッセージ数: ${converseMessages.length}`);
            converseMessages.forEach((msg, idx) => {
                const toolResults = msg.content?.filter(c => c.toolResult) || [];
                if (toolResults.length > 0) {
                    console.log(`[Bedrock] メッセージ${idx} (role: ${msg.role}): ${toolResults.length}個のtoolResultを含む`);
                }
            });
            
            // システムプロンプトの処理
            let systemPrompts = [];
            if (systemInstruction && systemInstruction.parts && systemInstruction.parts.length > 0) {
                const systemText = systemInstruction.parts[0].text;
                if (systemText) {
                    systemPrompts.push({ text: systemText });
                }
            }

            // リクエストボディの構築
            const requestBody = {
                modelId: modelId,
                messages: converseMessages,
                inferenceConfig: {}
            };

            // システムプロンプトを追加
            if (systemPrompts.length > 0) {
                requestBody.system = systemPrompts;
            }

            // 生成設定の追加
            if (generationConfig.maxOutputTokens) {
                requestBody.inferenceConfig.maxTokens = generationConfig.maxOutputTokens;
            }
            
            // Claude Sonnet 4.5では temperature と topP を同時に指定できないため、temperatureのみ使用
            const isClaudeSonnet45 = modelId.includes('claude-sonnet-4-5');
            
            if (generationConfig.temperature !== undefined && generationConfig.temperature !== null) {
                requestBody.inferenceConfig.temperature = generationConfig.temperature;
            }
            
            // Claude Sonnet 4.5以外の場合のみtopPを設定
            if (!isClaudeSonnet45 && generationConfig.topP !== undefined && generationConfig.topP !== null) {
                requestBody.inferenceConfig.topP = generationConfig.topP;
            } else if (isClaudeSonnet45 && generationConfig.topP !== undefined) {
                console.log('[Bedrock] Claude Sonnet 4.5では topP パラメータをスキップします（temperature と topP の同時指定不可のため）');
            }

            // Function Callingの処理
            if (state.settings.geminiEnableFunctionCalling && window.functionDeclarations) {
                const bedrockTools = this.convertGeminiToolsToBedrock(window.functionDeclarations);
                if (bedrockTools.length > 0) {
                    requestBody.toolConfig = {
                        tools: bedrockTools
                    };
                    
                    if (forceCalling) {
                        requestBody.toolConfig.toolChoice = { any: {} };
                    } else {
                        requestBody.toolConfig.toolChoice = { auto: {} };
                    }
                    
                    console.log(`Amazon Bedrock APIに ${bedrockTools.length} 個のFunction Callingツールを設定しました。`);
                }
            }

            console.log("Amazon Bedrockへの送信データ:", JSON.stringify(requestBody, (key, value) => {
                if (key === 'bytes' && value instanceof Uint8Array) {
                    return `[Uint8Array: ${value.length} bytes]`;
                }
                return value;
            }, 2));

            // Converse APIコマンドを実行
            const command = new window.ConverseCommand(requestBody);
            const response = await client.send(command);
            
            console.log("Amazon Bedrockからのレスポンス:", response);

            // レスポンスをGemini形式に変換
            const geminiFormatResponse = this.convertConverseToGeminiFormat(response);

            // Responseオブジェクトのように扱えるようにラップ
            return {
                ok: true,
                status: 200,
                json: async () => geminiFormatResponse
            };

        } catch (error) {
            console.error("Amazon Bedrock API呼び出しエラー:", error);
            throw new Error(`Bedrock APIエラー: ${error.message}`);
        }
    },

    // プロバイダーに応じて適切なAPIを呼び出すラッパー関数
    async callApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        const provider = state.settings.apiProvider || 'gemini';
        
        if (provider === 'zai') {
            return await this.callZaiApi(messagesForApi, generationConfig, systemInstruction, tools, forceCalling, signal);
        } else if (provider === 'openrouter') {
            return await this.callOpenRouterApi(messagesForApi, generationConfig, systemInstruction, tools, forceCalling, signal);
        } else if (provider === 'bedrock') {
            return await this.callBedrockApi(messagesForApi, generationConfig, systemInstruction, tools, forceCalling, signal);
        } else {
            return await this.callGeminiApi(messagesForApi, generationConfig, systemInstruction, tools, forceCalling, signal);
        }
    }
};
