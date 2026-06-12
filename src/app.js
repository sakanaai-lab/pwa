import("https://esm.run/@google/genai").then(module => {
    // 正しいクラス名 GoogleGenAI をグローバルスコープに設定
    window.GoogleGenAI = module.GoogleGenAI;
    console.log("Google GenAI SDK (@google/genai) の読み込みが完了しました。");
}).catch(err => {
    console.error("Google Gen AI SDKの読み込みに失敗しました:", err);
    // エラーメッセージを画面に表示するなどのフォールバック処理
    document.body.innerHTML = `<p style="color: red; padding: 20px;">SDKの読み込みに失敗しました。アプリを起動できません。</p>`;
});

// Phase 1: 純粋ユーティリティをモジュールから取り込む（挙動は従来通り）

// --- 定数 ---（src/constants.js へ抽出。挙動は不変）
import { GROQ_API_BASE_URL, DEEPSEEK_API_BASE_URL, XAI_API_BASE_URL, MISTRAL_API_BASE_URL } from './constants.js';
export let broadcastChannel = null; // タブ間通信用
// --- デバッグログ機能 ---
// デバッグログ機能（src/debug-logger.js へ抽出）


// 添付を確定する処理
// 拡張子→MIMEタイプ表（src/mime-types.js へ抽出）

// --- DOM要素 ---
import { elements } from './dom-elements.js';

// --- アプリ状態 ---
// --- アプリ状態 ---（src/state.js へ抽出。挙動は不変）
import { state } from "./state.js";

export function updateMessageMaxWidthVar() {
    const container = elements.messageContainer;
    if (!container) return;

    const isWideMode = state.settings.enableWideMode && window.innerWidth > 800;
    // ワイドモード時はコンテナ幅の70%、通常時は80%をメッセージの最大幅とする
    const percentage = isWideMode ? 0.7 : 0.8;
    let maxWidthPx = container.clientWidth * percentage;

    document.documentElement.style.setProperty('--message-max-width', `${maxWidthPx}px`);
}


let resizeTimer;
window.addEventListener('DOMContentLoaded', (event) => {
    console.log("DOM fully loaded and parsed. Initializing app...");
    appLogic.initializeApp();

    // iOS Safari: フォーカス時の自動ズームをblur後にリセット
    // フォントサイズ16px未満の入力欄がある場合に備えた保険
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
        document.addEventListener('focusout', () => {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
            requestAnimationFrame(() => {
                viewport.setAttribute('content', 'width=device-width, initial-scale=1');
            });
        });
    }
});

// --- ユーティリティ関数 ---
// sleep / interruptibleSleep / formatFileSize / base64ToBlob は
// src/utils/format.js へ抽出済み（ファイル冒頭で import）。

// --- Service Worker関連 ---
export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('このブラウザはService Workerをサポートしていません。');
        return;
    }

    // ページリロードの唯一のトリガーとしてcontrollerchangeを定義
    let isReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isReloading) return;
        isReloading = true;
        console.log("Controller has changed, reloading page for update...");
        window.location.reload();
    });

    const handleUpdateFound = (registration) => {
        const newWorker = registration.installing;
        if (newWorker) {
            console.log('新しいService Workerのインストールを検知しました。');
            newWorker.addEventListener('statechange', () => {
                // 新しいワーカーがインストールされ、待機状態になったら...
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('新しいService Workerが待機状態に入りました。アクティベートを試みます。');
                    // 確認なしで即座に更新を指示
                    if (state.db) {
                        state.db.close();
                        console.log("Service Worker更新のため、現在のDB接続を閉じました。");
                    }
                    newWorker.postMessage({ action: 'skipWaiting' });
                }
            });
        }
    };

    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.status === 'cacheCleared') {
            console.log('Service Workerから手動キャッシュクリア完了のメッセージを受信。リロードを実行します。');
            if (isReloading) return;
            isReloading = true;
            window.location.reload();
        }
    });

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('./sw.js');
            console.log('ServiceWorker登録成功 スコープ: ', registration.scope);

            const checkForUpdates = () => {
                navigator.serviceWorker.ready.then(readyRegistration => {
                    readyRegistration.update();
                }).catch(error => {
                    console.error('navigator.serviceWorker.ready failed:', error);
                });
            };

            // 各イベントでの更新チェックは維持
            setInterval(checkForUpdates, 60 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') checkForUpdates();
            });
            window.addEventListener('focus', checkForUpdates);

            // 待機中のワーカーがいれば即座に更新を試みる
            if (registration.waiting) {
                console.log('待機中の新しいService Workerが見つかりました。アクティベートを試みます。');
                // 確認なしで即座に更新を指示
                if (state.db) state.db.close();
                registration.waiting.postMessage({ action: 'skipWaiting' });
            }

            registration.addEventListener('updatefound', () => handleUpdateFound(registration));

        } catch (error) {
            console.error('ServiceWorker処理中にエラー: ', error);
        }
    });
}

// --- HTMLエスケープユーティリティ ---
// htmlUtils は src/utils/html.js へ抽出済み（ファイル冒頭で import）。

// --- IndexedDBユーティリティ (dbUtils) ---
import { dbUtils } from './db.js';

// --- UIユーティリティ (uiUtils) ---

// --- APIユーティリティ (apiUtils) ---
import { apiUtils } from './api.js';

function updateCurrentSystemPrompt() {
    const provider = state.settings.apiProvider;
    const commonPrompt = state.settings.systemPrompt || '';
    const specificPrompt = state.settings.systemPrompt || commonPrompt;

    // 新規チャット(メッセージがまだない状態)の場合のみ、
    // 設定のデフォルト値を state.currentSystemPrompt に反映する。
    // 既存チャットや、新規でもユーザーが編集したチャットは上書きしない。
    if (!state.currentChatId && state.currentMessages.length === 0) {
        state.currentSystemPrompt = specificPrompt;
        console.log(`新規チャットのため、デフォルトのシステムプロンプトを適用しました。`);
    } else {
        console.log(`既存チャットのため、デフォルトのシステムプロンプトによる上書きをスキップしました。`);
    }

    // ログ出力は関数の最後に移動
    console.log(`システムプロンプトを更新しました。Provider: ${provider}, Current Prompt: "${state.currentSystemPrompt.substring(0, 30)}..."`);
}

/**
 * タブ間通信のためのBroadcastChannelを設定する
 */
export function setupBroadcastChannel() {
    if ('BroadcastChannel' in window) {
        try {
            broadcastChannel = new BroadcastChannel('gemini-pwa-sync-channel');
            console.log('[BroadcastChannel] チャンネルに接続しました。');

            broadcastChannel.onmessage = async (event) => {
                const { type, newSyncId, sourceTabId } = event.data;

                // 自分のタブからのメッセージは無視
                if (sourceTabId === state.tabId) {
                    return;
                }

                console.log(`[BroadcastChannel] 他のタブからメッセージを受信:`, event.data);

                if (type === 'SYNC_COMPLETED' && newSyncId) {
                    // 自身のメモリ上の状態を更新
                    state.sync.lastSyncId = newSyncId;
                    state.sync.isDirty = false;
                    state.sync.lastError = null;
                    
                    // DBにも保存
                    await dbUtils.saveSetting('lastSyncId', newSyncId);
                    await dbUtils.saveSetting('syncIsDirty', false);
                    await dbUtils.saveSetting('syncLastError', null);
                    await dbUtils.saveSetting('lastSyncTimestamp', Date.now());

                    // UIを更新
                    await appLogic.updateDropboxUIState();
                }
            };
        } catch (error) {
            console.error('[BroadcastChannel] チャンネルの作成に失敗しました:', error);
        }
    } else {
        console.warn('[BroadcastChannel] このブラウザはBroadcastChannelをサポートしていません。');
    }
}

// --- アプリケーションロジック (appLogic) ---
import { appLogic } from './app-logic.js';

window.appLogic = appLogic;
window.state = state;
window.dbUtils = dbUtils;
// --- Phase 3 & 4: Settings Switchers & Project Management Hooks ---
(function() {
    function initHeaderModelSwitcher() {
        const headerSelect = document.getElementById('header-model-select');
        const mainSelect = document.getElementById('model-name');
        if (!headerSelect || !mainSelect) return;

        const syncToHeader = () => {
            if (mainSelect.innerHTML !== headerSelect.innerHTML) {
                headerSelect.innerHTML = mainSelect.innerHTML;
            }
            if (window.state && window.state.settings && window.state.settings.modelName) {
                if (headerSelect.value !== window.state.settings.modelName) {
                    headerSelect.value = window.state.settings.modelName;
                }
            } else if (headerSelect.value !== mainSelect.value) {
                headerSelect.value = mainSelect.value;
            }
        };

        const observer = new MutationObserver(syncToHeader);
        observer.observe(mainSelect, { childList: true, subtree: true });
        setInterval(syncToHeader, 1000);

        headerSelect.addEventListener('change', async (e) => {
            const newModel = e.target.value;
            const selectedOpt = headerSelect.options[headerSelect.selectedIndex];
            
            if (window.state && window.state.settings) {
                window.state.settings.modelName = newModel;
                mainSelect.value = newModel;

                // Sync API Provider if data-provider exists
                if (selectedOpt && selectedOpt.dataset.provider) {
                    const provider = selectedOpt.dataset.provider;
                    const apiProvSelect = document.getElementById('api-provider');
                    if (apiProvSelect && window.state.settings.apiProvider !== provider) {
                        window.state.settings.apiProvider = provider;
                        apiProvSelect.value = provider;
                        apiProvSelect.dispatchEvent(new Event('change'));
                        
                        // Sync to active profile
                        if (window.state.activeProfile) {
                            window.state.activeProfile.settings.apiProvider = provider;
                            if (window.dbUtils && typeof window.dbUtils.updateProfile === 'function') {
                                await window.dbUtils.updateProfile(window.state.activeProfile);
                            }
                        }
                    }
                } else if (newModel.startsWith('gemini-')) {
                    // Fallback for standard Gemini models
                    const apiProvSelect = document.getElementById('api-provider');
                    if (apiProvSelect && window.state.settings.apiProvider !== 'gemini') {
                        window.state.settings.apiProvider = 'gemini';
                        apiProvSelect.value = 'gemini';
                        apiProvSelect.dispatchEvent(new Event('change'));
                    }
                }
                
                // プロバイダーごとに最後に選んだモデルを記憶
                const curProvider = window.state.settings.apiProvider;
                if (curProvider && newModel) {
                    window.state.settings.lastModelPerProvider = window.state.settings.lastModelPerProvider || {};
                    window.state.settings.lastModelPerProvider[curProvider] = newModel;
                }
                if (window.state.activeProfile && window.dbUtils && typeof window.dbUtils.updateProfile === 'function') {
                    window.state.activeProfile.settings = window.state.activeProfile.settings || {};
                    window.state.activeProfile.settings.modelName = newModel;
                    window.state.activeProfile.settings.apiProvider = curProvider;
                    window.state.activeProfile.settings.lastModelPerProvider = window.state.settings.lastModelPerProvider;
                    await window.dbUtils.updateProfile(window.state.activeProfile);
                }
                console.log(`[Model Switcher] Model changed to: ${newModel} (Provider: ${window.state.settings.apiProvider})`);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initHeaderModelSwitcher, 500));
    } else {
        setTimeout(initHeaderModelSwitcher, 500);
    }
})();

// --- Phase 4: Project Management Hook ---
(function() {
    window.state.activeProjectId = null;
    window.state.activeProjectKnowledge = [];
    let projectsCache = [];

    async function initProjectManager() {
        const headerSelect = document.getElementById('header-project-select');
        const dialog = document.getElementById('projectManagementDialog');
        if (!headerSelect || !dialog) return;

        // DB methods
        if (window.dbUtils) {
            window.dbUtils.getAllProjects = async () => {
                const db = await window.dbUtils.openDB();
                return new Promise((resolve, reject) => {
                    if (!db.objectStoreNames.contains('projects')) return resolve([]);
                    const req = db.transaction('projects', 'readonly').objectStore('projects').getAll();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            };
            window.dbUtils.addProject = async (project) => {
                const db = await window.dbUtils.openDB();
                return new Promise((resolve, reject) => {
                    const req = db.transaction('projects', 'readwrite').objectStore('projects').add(project);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            };
            window.dbUtils.deleteProject = async (id) => {
                const db = await window.dbUtils.openDB();
                return new Promise((resolve, reject) => {
                    const req = db.transaction('projects', 'readwrite').objectStore('projects').delete(id);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
            };
            window.dbUtils.updateProject = async (project) => {
                const db = await window.dbUtils.openDB();
                return new Promise((resolve, reject) => {
                    const req = db.transaction('projects', 'readwrite').objectStore('projects').put(project);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
            };
            
            // Patch getAllChats to filter by activeProjectId
            const originalGetAllChats = window.dbUtils.getAllChats;
            window.dbUtils.getAllChatsUnfiltered = originalGetAllChats.bind(window.dbUtils);
            window.dbUtils.getAllChats = async function(sortBy) {
                const allChats = await originalGetAllChats.call(this, sortBy);
                if (window.state.activeProjectId) {
                    return allChats.filter(c => c.projectId === window.state.activeProjectId);
                }
                return allChats;
            };

        }

        // Patch startNewChat for New Chat behavior
        if (window.appLogic && window.appLogic.startNewChat) {
            const originalStartNewChat = window.appLogic.startNewChat;
            window.appLogic.startNewChat = function() {
                originalStartNewChat.call(this);
                if (window.state.activeProjectId) {
                    const activeP = projectsCache.find(p => p.id === window.state.activeProjectId);
                    if (activeP) {
                        if (activeP.systemPrompt) {
                            window.state.currentSystemPrompt = activeP.systemPrompt;
                            const editor = document.getElementById('system-prompt-editor');
                            if (editor) editor.value = activeP.systemPrompt;
                        }
                        window.state.activeProjectKnowledge = activeP.knowledgeFiles || [];
                        if (activeP.defaultModel) {
                            const headerModelSelect = document.getElementById('header-model-select');
                            if (headerModelSelect) {
                                headerModelSelect.value = activeP.defaultModel;
                                headerModelSelect.dispatchEvent(new Event('change'));
                            }
                        }
                    }
                } else {
                    window.state.activeProjectKnowledge = [];
                }
            };
        }

        async function loadProjects() {
            if (!window.dbUtils || !window.dbUtils.getAllProjects) return;
            projectsCache = await window.dbUtils.getAllProjects();
            window.projectsCache = projectsCache;

            // Update Header Select
            // activeProjectId が既に設定されていればそれを優先、なければ現在のUIの値を使う
            const currentVal = (window.state.activeProjectId != null ? String(window.state.activeProjectId) : null) || headerSelect.value;
            headerSelect.innerHTML = '<option value="">すべてのプロジェクト</option><option value="manage">⚙️ プロジェクト管理...</option>';
            projectsCache.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                headerSelect.appendChild(opt);
            });
            if (currentVal && projectsCache.find(p => p.id === parseInt(currentVal, 10))) {
                headerSelect.value = currentVal;
                window.state.activeProjectId = parseInt(currentVal, 10);
            } else if (currentVal === 'manage') {
                headerSelect.value = window.state.activeProjectId || "";
            } else {
                headerSelect.value = "";
                window.state.activeProjectId = null;
            }

            // Update Dialog List
            const listContainer = document.getElementById('project-list-container');
            if (!listContainer) return;
            listContainer.innerHTML = '';
            projectsCache.forEach(p => {
                const div = document.createElement('div');
                div.className = 'project-item';
                div.innerHTML = `
                    <div class="project-item-header">
                        <span class="project-item-title">${p.name}</span>
                        <div class="project-item-actions">
                            <button class="edit-prompt-btn" data-id="${p.id}" title="指示を編集"><span class="material-symbols-outlined">edit</span></button>
                            <button class="delete-project-btn" data-id="${p.id}" title="削除"><span class="material-symbols-outlined">delete</span></button>
                        </div>
                    </div>
                `;
                // System prompt preview + edit area
                const promptPreview = document.createElement('div');
                promptPreview.className = 'project-item-system-prompt';
                promptPreview.textContent = p.systemPrompt || '（指示なし）';
                promptPreview.style.cssText = p.systemPrompt ? '' : 'color:var(--text-secondary,#888); font-style:italic;';
                div.appendChild(promptPreview);

                const promptEditArea = document.createElement('div');
                promptEditArea.style.cssText = 'display:none; margin-top:6px;';

                // Name edit field
                const nameLabel = document.createElement('label');
                nameLabel.textContent = 'プロジェクト名';
                nameLabel.style.cssText = 'font-size:0.85em; color:var(--text-secondary,#888); display:block; margin-bottom:2px;';
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.value = p.name || '';
                nameInput.style.cssText = 'width:100%; font-size:0.9em; box-sizing:border-box; margin-bottom:8px; padding:4px 6px;';

                const promptLabel = document.createElement('label');
                promptLabel.textContent = 'システムプロンプト';
                promptLabel.style.cssText = 'font-size:0.85em; color:var(--text-secondary,#888); display:block; margin-bottom:2px;';
                const promptTextarea = document.createElement('textarea');
                promptTextarea.value = p.systemPrompt || '';
                promptTextarea.placeholder = 'このプロジェクトのシステムプロンプトを入力...';
                promptTextarea.style.cssText = 'width:100%; height:100px; font-size:0.9em; box-sizing:border-box; resize:vertical;';
                const promptSaveBtn = document.createElement('button');
                promptSaveBtn.textContent = '保存';
                promptSaveBtn.style.cssText = 'margin-top:4px; margin-right:4px; font-size:0.85em;';
                const promptCancelBtn = document.createElement('button');
                promptCancelBtn.textContent = 'キャンセル';
                promptCancelBtn.style.cssText = 'margin-top:4px; font-size:0.85em;';
                promptEditArea.appendChild(nameLabel);
                promptEditArea.appendChild(nameInput);
                promptEditArea.appendChild(promptLabel);
                promptEditArea.appendChild(promptTextarea);
                promptEditArea.appendChild(document.createElement('br'));
                promptEditArea.appendChild(promptSaveBtn);
                promptEditArea.appendChild(promptCancelBtn);
                div.appendChild(promptEditArea);

                div.querySelector('.edit-prompt-btn').onclick = () => {
                    const isOpen = promptEditArea.style.display !== 'none';
                    promptEditArea.style.display = isOpen ? 'none' : 'block';
                    if (!isOpen) {
                        nameInput.value = p.name || '';
                        promptTextarea.value = p.systemPrompt || '';
                        nameInput.focus();
                    }
                };
                promptCancelBtn.onclick = () => { promptEditArea.style.display = 'none'; };
                promptSaveBtn.onclick = async () => {
                    const newName = nameInput.value.trim();
                    const newPrompt = promptTextarea.value.trim();
                    if (newName) {
                        p.name = newName;
                        div.querySelector('.project-item-title').textContent = newName;
                        // ヘッダーのselectも更新
                        const headerSelect = document.getElementById('project-filter-select');
                        if (headerSelect) {
                            const opt = headerSelect.querySelector(`option[value="${p.id}"]`);
                            if (opt) opt.textContent = newName;
                        }
                    }
                    p.systemPrompt = newPrompt;
                    p.updatedAt = Date.now();
                    await window.dbUtils.updateProject(p);
                    promptPreview.textContent = newPrompt || '（指示なし）';
                    promptPreview.style.cssText = newPrompt ? '' : 'color:var(--text-secondary,#888); font-style:italic;';
                    promptEditArea.style.display = 'none';
                    if (window.state.activeProjectId === p.id) {
                        window.state.currentSystemPrompt = newPrompt;
                        const editor = document.getElementById('system-prompt-editor');
                        if (editor) editor.value = newPrompt;
                        // 現在読み込み中のチャットにも反映
                        if (window.appLogic && window.state.currentChatId) {
                            await window.dbUtils.saveChat().catch(() => {});
                        }
                    }
                };

                // Knowledge files section
                const kSection = document.createElement('div');
                kSection.style.cssText = 'margin-top:8px; border-top:1px solid rgba(128,128,128,0.2); padding-top:8px;';
                const kHeader = document.createElement('div');
                kHeader.style.cssText = 'display:flex; align-items:center; justify-content:space-between; font-size:0.82em; color:var(--text-secondary, #888);';
                const kLabel = document.createElement('span');
                kLabel.textContent = `ナレッジ (${(p.knowledgeFiles || []).length}件)`;
                const kAddBtn = document.createElement('button');
                kAddBtn.className = 'add-knowledge-btn';
                kAddBtn.dataset.id = p.id;
                kAddBtn.title = 'ファイルを追加';
                kAddBtn.style.cssText = 'background:none; border:none; cursor:pointer; padding:2px; color:inherit; display:flex; align-items:center;';
                kAddBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">attach_file</span>';
                kHeader.appendChild(kLabel);
                kHeader.appendChild(kAddBtn);
                kSection.appendChild(kHeader);

                const kList = document.createElement('div');
                kList.style.cssText = 'margin-top:4px;';
                (p.knowledgeFiles || []).forEach(f => {
                    const fDiv = document.createElement('div');
                    fDiv.style.cssText = 'font-size:0.8em; padding:2px 0;';

                    const fRow = document.createElement('div');
                    fRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between;';
                    const fName = document.createElement('span');
                    fName.textContent = `📄 ${f.name}`;
                    fName.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%;';
                    const fBtns = document.createElement('div');
                    fBtns.style.cssText = 'display:flex; align-items:center; flex-shrink:0;';
                    const fEdit = document.createElement('button');
                    fEdit.className = 'edit-knowledge-btn';
                    fEdit.dataset.projectId = p.id;
                    fEdit.dataset.fileName = f.name;
                    fEdit.style.cssText = 'background:none; border:none; cursor:pointer; padding:0 2px; color:inherit; display:flex; align-items:center;';
                    fEdit.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">edit</span>';
                    const fDel = document.createElement('button');
                    fDel.className = 'delete-knowledge-btn';
                    fDel.dataset.projectId = p.id;
                    fDel.dataset.fileName = f.name;
                    fDel.style.cssText = 'background:none; border:none; cursor:pointer; padding:0 2px; color:inherit; display:flex; align-items:center;';
                    fDel.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">close</span>';
                    fBtns.appendChild(fEdit);
                    fBtns.appendChild(fDel);
                    fRow.appendChild(fName);
                    fRow.appendChild(fBtns);

                    const fEditArea = document.createElement('div');
                    fEditArea.style.cssText = 'display:none; margin-top:4px;';
                    const fTextarea = document.createElement('textarea');
                    fTextarea.value = f.content || '';
                    fTextarea.style.cssText = 'width:100%; height:120px; font-size:0.9em; box-sizing:border-box; resize:vertical;';
                    const fSaveBtn = document.createElement('button');
                    fSaveBtn.textContent = '保存';
                    fSaveBtn.style.cssText = 'margin-top:4px; margin-right:4px; font-size:0.85em;';
                    const fCancelBtn = document.createElement('button');
                    fCancelBtn.textContent = 'キャンセル';
                    fCancelBtn.style.cssText = 'margin-top:4px; font-size:0.85em;';
                    fEditArea.appendChild(fTextarea);
                    fEditArea.appendChild(document.createElement('br'));
                    fEditArea.appendChild(fSaveBtn);
                    fEditArea.appendChild(fCancelBtn);

                    fEdit.onclick = () => {
                        fTextarea.value = f.content || '';
                        fEditArea.style.display = fEditArea.style.display === 'none' ? 'block' : 'none';
                    };
                    fCancelBtn.onclick = () => { fEditArea.style.display = 'none'; };
                    fSaveBtn.onclick = async () => {
                        const projectId = parseInt(fSaveBtn.closest('[data-pid]')?.dataset.pid || fEdit.dataset.projectId, 10);
                        const project = projectsCache.find(proj => proj.id === parseInt(fEdit.dataset.projectId, 10));
                        if (!project) return;
                        const idx = (project.knowledgeFiles || []).findIndex(kf => kf.name === f.name);
                        if (idx >= 0) {
                            project.knowledgeFiles[idx] = { ...project.knowledgeFiles[idx], content: fTextarea.value };
                            await window.dbUtils.updateProject(project);
                            if (window.state.activeProjectId === project.id) {
                                window.state.activeProjectKnowledge = project.knowledgeFiles;
                            }
                            f.content = fTextarea.value;
                            fEditArea.style.display = 'none';
                        }
                    };

                    fDiv.appendChild(fRow);
                    fDiv.appendChild(fEditArea);
                    kList.appendChild(fDiv);
                });
                kSection.appendChild(kList);
                div.appendChild(kSection);
                listContainer.appendChild(div);
            });

            listContainer.querySelectorAll('.delete-project-btn').forEach(btn => {
                btn.onclick = async () => {
                    if (confirm('このプロジェクトを削除しますか？\n(紐づいているチャットデータ自体は削除されず、「すべてのプロジェクト」に表示されます)')) {
                        await window.dbUtils.deleteProject(parseInt(btn.dataset.id, 10));
                        await loadProjects();
                        if (window.state.activeProjectId === parseInt(btn.dataset.id, 10)) {
                            headerSelect.value = "";
                            headerSelect.dispatchEvent(new Event('change'));
                        }
                    }
                };
            });


            async function extractPdfText(file) {
                if (!window.pdfjsLib) {
                    await new Promise((resolve, reject) => {
                        const s = document.createElement('script');
                        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                        s.onload = resolve;
                        s.onerror = reject;
                        document.head.appendChild(s);
                    });
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                }
                const buf = await file.arrayBuffer();
                const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
                let text = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items.map(item => item.str).join(' ');
                    text += `[Page ${i}]\n${pageText}\n\n`;
                }
                return text.trim();
            }

            listContainer.querySelectorAll('.add-knowledge-btn').forEach(btn => {
                btn.onclick = () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.accept = '.txt,.md,.csv,.json,.js,.ts,.jsx,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.html,.css,.xml,.yaml,.yml,.toml,.log,.sh,.pdf';
                    input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
                    document.body.appendChild(input);
                    input.onchange = async (e) => {
                        document.body.removeChild(input);
                        const projectId = parseInt(btn.dataset.id, 10);
                        const project = projectsCache.find(p => p.id === projectId);
                        if (!project) return;
                        const knowledgeFiles = project.knowledgeFiles ? [...project.knowledgeFiles] : [];
                        for (const file of Array.from(e.target.files)) {
                            let content;
                            try {
                                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                                    content = await extractPdfText(file);
                                } else {
                                    content = await file.text();
                                }
                            } catch (err) {
                                alert(`${file.name} の読み込みに失敗しました: ${err.message}`);
                                continue;
                            }
                            const idx = knowledgeFiles.findIndex(f => f.name === file.name);
                            const entry = { name: file.name, content, addedAt: Date.now() };
                            if (idx >= 0) knowledgeFiles[idx] = entry;
                            else knowledgeFiles.push(entry);
                        }
                        project.knowledgeFiles = knowledgeFiles;
                        await window.dbUtils.updateProject(project);
                        if (window.state.activeProjectId === projectId) {
                            window.state.activeProjectKnowledge = knowledgeFiles;
                        }
                        await loadProjects();
                    };
                    input.click();
                };
            });

            listContainer.querySelectorAll('.delete-knowledge-btn').forEach(btn => {
                btn.onclick = async () => {
                    const projectId = parseInt(btn.dataset.projectId, 10);
                    const project = projectsCache.find(p => p.id === projectId);
                    if (!project) return;
                    project.knowledgeFiles = (project.knowledgeFiles || []).filter(f => f.name !== btn.dataset.fileName);
                    await window.dbUtils.updateProject(project);
                    if (window.state.activeProjectId === projectId) {
                        window.state.activeProjectKnowledge = project.knowledgeFiles;
                    }
                    await loadProjects();
                };
            });
        }

        headerSelect.addEventListener('change', async (e) => {
            if (e.target.value === 'manage') {
                e.target.value = window.state.activeProjectId || "";
                dialog.showModal();
                return;
            }
            window.state.activeProjectId = e.target.value ? parseInt(e.target.value, 10) : null;
            // 選択プロジェクトをリロード後も復元できるよう保存
            window.dbUtils.saveSetting('activeProjectId', window.state.activeProjectId).catch(() => {});
            const switchedP = window.state.activeProjectId ? projectsCache.find(p => p.id === window.state.activeProjectId) : null;
            window.state.activeProjectKnowledge = switchedP ? (switchedP.knowledgeFiles || []) : [];
            if (window.uiUtils && typeof window.uiUtils.loadHistoryList === 'function') {
                await window.uiUtils.loadHistoryList();
            }

            // If we are currently on a new/empty chat, apply project prompt immediately
            if (!window.state.currentChatId && window.appLogic && window.appLogic.startNewChat) {
                window.appLogic.startNewChat();
            }
        });

        const createBtn = document.getElementById('create-project-btn');
        if (createBtn) {
            createBtn.onclick = async () => {
                const nameInput = document.getElementById('new-project-name');
                const promptInput = document.getElementById('new-project-prompt');
                const modelInput = document.getElementById('new-project-model');
                
                if (!nameInput.value.trim()) {
                    alert('プロジェクト名を入力してください。');
                    return;
                }
                
                const newProject = {
                    name: nameInput.value.trim(),
                    systemPrompt: promptInput.value.trim(),
                    defaultModel: modelInput ? modelInput.value : '',
                    createdAt: Date.now()
                };
                
                await window.dbUtils.addProject(newProject);
                nameInput.value = '';
                promptInput.value = '';
                if(modelInput) modelInput.value = '';
                
                await loadProjects();
            };
        }

        const closeBtn = document.getElementById('close-project-dialog-btn');
        if (closeBtn) {
            closeBtn.onclick = () => dialog.close();
        }
        
        const mainSelect = document.getElementById('model-name');
        const projModelSelect = document.getElementById('new-project-model');
        if (mainSelect && projModelSelect) {
            const syncModelOpts = () => {
                const currentVal = projModelSelect.value;
                projModelSelect.innerHTML = '<option value="">(グローバル設定に従う)</option>' + mainSelect.innerHTML;
                projModelSelect.value = currentVal;
            };
            new MutationObserver(syncModelOpts).observe(mainSelect, { childList: true, subtree: true });
            setTimeout(syncModelOpts, 1000);
        }

        // リロード後に選択プロジェクトを復元
        if (window.dbUtils && window.dbUtils.getSetting) {
            const savedProject = await window.dbUtils.getSetting('activeProjectId');
            if (savedProject && savedProject.value != null) {
                window.state.activeProjectId = savedProject.value;
            }
        }

        await loadProjects();

        // プロジェクトが選択されている場合はナレッジとプロンプトを反映
        if (window.state.activeProjectId) {
            const activeP = projectsCache.find(p => p.id === window.state.activeProjectId);
            if (activeP) {
                window.state.activeProjectKnowledge = activeP.knowledgeFiles || [];
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initProjectManager, 800));
    } else {
        setTimeout(initProjectManager, 800);
    }
})();

/* =========================================================================
 * Phase 6 Hook: Multi-Provider (OpenAI, Anthropic) & Custom Models
 * ========================================================================= */
(()=>{
    const oCallApi = window.appLogic?.callApi;

    // 1. Initial UI setup & Custom Models Rendering (Phase 6 + 7 Accordion and Textareas)
    const initPhase7 = () => {
        const customGroup = document.getElementById('user-defined-models-group');
        const mainSelect = document.getElementById('model-name');

        // Fetch All Models Button
        const fetchModelsBtn = document.getElementById('fetch-all-models-btn');
        if (fetchModelsBtn) {
            fetchModelsBtn.addEventListener('click', async () => {
                fetchModelsBtn.disabled = true;
                fetchModelsBtn.textContent = '取得中...';
                const results = [];

                function mergeModels(provider, newModels) {
                    if (!newModels.length) return;
                    if (!state.settings.fetchedModels) state.settings.fetchedModels = {};
                    // Replace (not merge) so deprecated models disappear automatically
                    state.settings.fetchedModels[provider] = newModels;
                }

                async function fetchOpenAICompat(url, apiKey, provider, filter) {
                    try {
                        const r = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
                        if (!r.ok) { results.push(`${provider}: HTTP ${r.status}`); return; }
                        const d = await r.json();
                        const models = (d.data || []).map(m => m.id).filter(id => id && (!filter || filter(id)));
                        mergeModels(provider, models);
                        results.push(`${provider}: ${models.length}件`);
                    } catch(e) { results.push(`${provider}: エラー (${e.message})`); }
                }

                // Gemini
                if (state.settings.apiKey) {
                    try {
                        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${state.settings.apiKey}&pageSize=100`);
                        if (r.ok) {
                            const d = await r.json();
                            const models = (d.models || [])
                                .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                                .map(m => m.name.replace('models/', ''))
                                .filter(id => id.includes('gemini'));
                            mergeModels('gemini', models);
                            results.push(`Gemini: ${models.length}件`);
                        } else { results.push(`Gemini: HTTP ${r.status}`); }
                    } catch(e) { results.push(`Gemini: エラー`); }
                }

                // Anthropic
                if (state.settings.anthropicApiKey) {
                    try {
                        const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
                            headers: { 'x-api-key': state.settings.anthropicApiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
                        });
                        if (r.ok) {
                            const d = await r.json();
                            const models = (d.data || []).map(m => m.id);
                            mergeModels('anthropic', models);
                            results.push(`Anthropic: ${models.length}件`);
                        } else { results.push(`Anthropic: HTTP ${r.status}`); }
                    } catch(e) { results.push(`Anthropic: エラー`); }
                }

                // OpenAI
                if (state.settings.openaiApiKey) {
                    await fetchOpenAICompat('https://api.openai.com/v1/models', state.settings.openaiApiKey, 'openai',
                        id => /^(gpt|o\d|chatgpt)/i.test(id));
                }

                // OpenAI-compatible providers
                const compatList = [
                    { key: 'groq',     url: 'https://api.groq.com/openai/v1/models',    apiKey: state.settings.groqApiKey },
                    { key: 'deepseek', url: 'https://api.deepseek.com/v1/models',        apiKey: state.settings.deepseekApiKey },
                    { key: 'xai',      url: 'https://api.x.ai/v1/models',               apiKey: state.settings.xaiApiKey },
                    { key: 'mistral',  url: 'https://api.mistral.ai/v1/models',          apiKey: state.settings.mistralApiKey },
                ];
                for (const p of compatList) {
                    if (p.apiKey) await fetchOpenAICompat(p.url, p.apiKey, p.key, null);
                }

                // Persist fetchedModels and refresh dropdown
                if (window.dbUtils && typeof window.dbUtils.saveSetting === 'function') {
                    window.dbUtils.saveSetting('fetchedModels', state.settings.fetchedModels).catch(() => {});
                }
                const apiProvSelect = document.getElementById('api-provider');
                if (apiProvSelect) apiProvSelect.dispatchEvent(new Event('change'));

                fetchModelsBtn.disabled = false;
                fetchModelsBtn.textContent = '🔄 全プロバイダーの最新モデルを取得';
                if (results.length) {
                    alert('モデル取得完了:\n' + results.join('\n'));
                } else {
                    alert('APIキーが設定されているプロバイダーが見つかりませんでした。');
                }
            });
        }

        // Save Settings Button
        const saveBtn = document.getElementById('save-settings-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                // Ensure custom fields are synced to active profile before saving
                if (window.state.activeProfile) {
                    window.state.activeProfile.settings.openaiApiKey = state.settings.openaiApiKey;
                    window.state.activeProfile.settings.anthropicApiKey = state.settings.anthropicApiKey;
                    window.state.activeProfile.settings.customModelsText = state.settings.customModelsText;
                    
                    if (window.dbUtils && typeof window.dbUtils.updateProfile === 'function') {
                        await window.dbUtils.updateProfile(window.state.activeProfile);
                    }
                }

                if (window.dbUtils && typeof window.dbUtils.saveSettings === 'function') {
                    await window.dbUtils.saveSettings(window.state.settings);
                }
                
                // Show a brief visual confirmation without alert that requires interaction
                const originalText = saveBtn.innerText;
                saveBtn.innerText = "✓ 保存しました";
                saveBtn.style.backgroundColor = "#1a6b7a";
                setTimeout(() => {
                    saveBtn.innerText = "設定を保存";
                    saveBtn.style.backgroundColor = "#2196a8";
                }, 2000);
            });
        }

        const persistCustomSetting = async (key, value) => {
            state.settings[key] = value;
            if (window.state.activeProfile) {
                window.state.activeProfile.settings[key] = value;
                if (window.dbUtils && typeof window.dbUtils.updateProfile === 'function') {
                    await window.dbUtils.updateProfile(window.state.activeProfile);
                }
            }
            if (window.dbUtils && typeof window.dbUtils.saveSettings === 'function') {
                await window.dbUtils.saveSettings(window.state.settings);
            }
        };

        const apiProvSelect = document.getElementById('api-provider');
        if(apiProvSelect) {
            const updateKeyVisibility = () => {
                const p = apiProvSelect.value;
                ['gemini', 'zai', 'openrouter', 'bedrock', 'openai', 'anthropic', 'groq', 'deepseek', 'xai', 'mistral'].forEach(prov => {
                    document.getElementById(`${prov}-api-key-container`)?.classList.toggle('hidden', p !== prov);
                });
            };
            apiProvSelect.addEventListener('change', updateKeyVisibility);
            setTimeout(updateKeyVisibility, 500);
        }

        const providers = ['gemini', 'zai', 'openrouter', 'bedrock', 'openai', 'anthropic', 'groq', 'deepseek', 'xai', 'mistral'];
        const defaultModelLists = {
            gemini: 'gemini-2.0-flash, gemini-2.0-flash-lite-preview-02-05, gemini-2.0-pro-exp-02-05, gemini-1.5-pro, gemini-1.5-flash',
            openai: 'gpt-4o, gpt-4o-mini, o1, o1-mini, o3-mini',
            anthropic: 'claude-3-7-sonnet-20250219, claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022',
            groq: 'llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it',
            deepseek: 'deepseek-chat, deepseek-reasoner',
            xai: 'grok-3, grok-3-mini, grok-2-1212',
            mistral: 'mistral-large-latest, mistral-small-latest, open-mistral-nemo',
            zai: 'deepseek-v3, deepseek-r1',
            openrouter: 'deepseek/deepseek-chat, deepseek/deepseek-r1, google/gemini-2.0-flash-001, anthropic/claude-3.5-sonnet',
            bedrock: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0, us.anthropic.claude-3-5-haiku-20241022-v1:0'
        };

        state.settings.customModelsText = state.settings.customModelsText || {};
        state.settings.fetchedModels = state.settings.fetchedModels || {};
        state.settings.lastModelPerProvider = state.settings.lastModelPerProvider || {};
        // Fill defaults for empty providers and persist
        let defaultsApplied = false;
        providers.forEach(prov => {
            if (!state.settings.customModelsText[prov] && defaultModelLists[prov]) {
                state.settings.customModelsText[prov] = defaultModelLists[prov];
                defaultsApplied = true;
            }
        });

        if (defaultsApplied && window.state.activeProfile) {
            window.state.activeProfile.settings.customModelsText = state.settings.customModelsText;
            if (window.dbUtils && typeof window.dbUtils.updateProfile === 'function') {
                window.dbUtils.updateProfile(window.state.activeProfile);
            }
        }

        // Migrate old array logic to textareas if necessary
        if (state.settings.customModels && Array.isArray(state.settings.customModels)) {
            state.settings.customModels.forEach(cm => {
                if (cm && cm.id && cm.provider) {
                    const existing = state.settings.customModelsText[cm.provider] || '';
                    if (!existing.includes(cm.id)) {
                        state.settings.customModelsText[cm.provider] = existing ? `${existing}, ${cm.id}` : cm.id;
                    }
                }
            });
            delete state.settings.customModels;
            if (window.dbUtils && typeof window.dbUtils.saveSettings === 'function') window.dbUtils.saveSettings(window.state.settings);
        }

        const renderCustomModels = () => {
            if(customGroup) customGroup.innerHTML = '';
            
            // Rebuild the unified custom models list mapped to UI dropdown
            providers.forEach(prov => {
                const text = state.settings.customModelsText[prov] || '';
                const ids = text.split(',').map(s => s.trim()).filter(Boolean);
                ids.forEach(id => {
                    if (customGroup) {
                        const opt = document.createElement('option');
                        opt.value = id;
                        opt.textContent = `${id} (${prov})`;
                        // We attach dataset provider because we need to know the origin when selected
                        opt.dataset.provider = prov;
                        opt.dataset.userDefined = 'true';
                        customGroup.appendChild(opt);
                    }
                });
            });
        };

        providers.forEach(prov => {
            const textarea = document.getElementById(`${prov}-custom-models`);
            if (textarea) {
                // Restore from state
                if (state.settings.customModelsText[prov]) {
                    textarea.value = state.settings.customModelsText[prov];
                }
                
                // Update state on change
                textarea.addEventListener('change', async (e) => {
                    state.settings.customModelsText[prov] = e.target.value;
                    await persistCustomSetting('customModelsText', state.settings.customModelsText);
                    renderCustomModels();
                    apiProvSelect?.dispatchEvent(new Event('change'));
                });
            }
        });

        if(mainSelect && apiProvSelect) {
            mainSelect.addEventListener('change', async (e) => {
                const selectedOpt = mainSelect.options[mainSelect.selectedIndex];
                const newModel = mainSelect.value;
                
                let provider = null;
                if (selectedOpt && selectedOpt.dataset.provider) {
                    provider = selectedOpt.dataset.provider;
                } else if (newModel.startsWith('gemini-')) {
                    provider = 'gemini';
                }

                if (provider && state.settings.apiProvider !== provider) {
                    state.settings.apiProvider = provider;
                    apiProvSelect.value = provider;
                    apiProvSelect.dispatchEvent(new Event('change'));
                    await persistCustomSetting('apiProvider', provider);
                }
            });
        }

        renderCustomModels();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initPhase7, 1200));
    } else {
        setTimeout(initPhase7, 1200);
    }

    // 2. Intercept API Calls for multi-provider support
    const oApiUtilsCallApi = apiUtils.callApi;

    const multiProviderCallApi = async function(messagesForApi, config, systemInstruction, tools, forceCalling, signal) {
        // Inject project knowledge files into system instruction
        const knowledge = window.state.activeProjectKnowledge;
        if (knowledge && knowledge.length > 0) {
            const knowledgeText = knowledge.map(f => `### ${f.name}\n${f.content}`).join('\n\n---\n\n');
            const prevStatic = systemInstruction?._staticText !== undefined
                ? systemInstruction._staticText
                : (extractSystemText(systemInstruction) || '');
            const prevDynamic = systemInstruction?._dynamicText || '';
            const newStaticText = prevStatic
                ? `${prevStatic}\n\n---\n## ナレッジ\n\n${knowledgeText}`
                : `## ナレッジ\n\n${knowledgeText}`;
            const combined = [prevDynamic, newStaticText].filter(Boolean).join('\n\n');
            systemInstruction = {
                parts: [{ text: combined }],
                _staticText: newStaticText,
                _dynamicText: prevDynamic
            };
        }

        const provider = state.settings.apiProvider || 'gemini';

        if (provider === 'openai') {
            return await callOpenAIApiWrapper(messagesForApi, config, systemInstruction, tools, forceCalling, signal);
        } else if (provider === 'anthropic') {
            return await callAnthropicApiWrapper(messagesForApi, config, systemInstruction, tools, forceCalling, signal);
        } else if (provider === 'groq') {
            return await callOpenAICompatibleApi(state.settings.groqApiKey, GROQ_API_BASE_URL, 'Groq', messagesForApi, config, systemInstruction, signal);
        } else if (provider === 'deepseek') {
            return await callOpenAICompatibleApi(state.settings.deepseekApiKey, DEEPSEEK_API_BASE_URL, 'DeepSeek', messagesForApi, config, systemInstruction, signal);
        } else if (provider === 'xai') {
            return await callOpenAICompatibleApi(state.settings.xaiApiKey, XAI_API_BASE_URL, 'xAI', messagesForApi, config, systemInstruction, signal);
        } else if (provider === 'mistral') {
            return await callOpenAICompatibleApi(state.settings.mistralApiKey, MISTRAL_API_BASE_URL, 'Mistral', messagesForApi, config, systemInstruction, signal);
        } else {
            return await oApiUtilsCallApi.call(this, messagesForApi, config, systemInstruction, tools, forceCalling, signal);
        }
    };

    // Patch both apiUtils.callApi (used by callApiWithRetry) and window.appLogic.callApi
    apiUtils.callApi = multiProviderCallApi;
    if (window.appLogic) {
        window.appLogic.callApi = multiProviderCallApi;
    }

    function extractSystemText(systemInstruction) {
        if (!systemInstruction) return null;
        if (typeof systemInstruction === 'string') return systemInstruction;
        if (systemInstruction.parts) return systemInstruction.parts.map(p => p.text || '').join('');
        return null;
    }

    async function callOpenAIApiWrapper(messages, config, systemInstruction, tools, forceCalling, signal) {
        const apiKey = state.settings.openaiApiKey;
        if (!apiKey) { const e = new Error("OpenAI APIキーが設定されていません。設定画面で追加してください。"); e.status = 401; throw e; }

        const model = state.settings.modelName || 'gpt-4o';
        const isReasoningModel = /^o\d/i.test(model);
        const requestBody = {
            model,
            messages: [],
            max_completion_tokens: config.maxOutputTokens ?? 4000,
            stream: false
        };
        if (!isReasoningModel) {
            requestBody.temperature = config.temperature ?? 0.7;
            requestBody.top_p = config.topP ?? 1.0;
        }

        const systemText = extractSystemText(systemInstruction);
        if (systemText) requestBody.messages.push({ role: 'system', content: systemText });
        apiUtils.convertGeminiToOpenAIFormat(messages).forEach(msg => requestBody.messages.push(msg));

        // Gemini形式のfunction_declarationsをOpenAI tools形式に変換
        if (tools && tools.length > 0) {
            const convertTypes = (schema) => {
                if (!schema || typeof schema !== 'object') return schema;
                if (Array.isArray(schema)) return schema.map(convertTypes);
                const result = {};
                for (const [key, val] of Object.entries(schema)) {
                    if (key === 'type' && typeof val === 'string') {
                        result[key] = val.toLowerCase();
                    } else if (val && typeof val === 'object') {
                        result[key] = convertTypes(val);
                    } else {
                        result[key] = val;
                    }
                }
                return result;
            };
            const openAITools = [];
            for (const toolGroup of tools) {
                for (const decl of (toolGroup.function_declarations || [])) {
                    openAITools.push({
                        type: 'function',
                        function: {
                            name: decl.name,
                            description: decl.description || '',
                            parameters: convertTypes(decl.parameters) || { type: 'object', properties: {} }
                        }
                    });
                }
            }
            if (openAITools.length > 0) {
                requestBody.tools = openAITools;
                if (forceCalling) requestBody.tool_choice = 'required';
            }
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(requestBody),
            signal
        });

        if (!response.ok) {
            const err = await response.json().catch(()=>({}));
            const e = new Error(`OpenAI APIエラー: ${err.error?.message || response.statusText}`);
            e.status = response.status;
            throw e;
        }
        const data = await response.json();
        const geminiFormat = apiUtils.convertOpenAIToGeminiFormat(data);
        return { ok: true, status: 200, json: async () => geminiFormat };
    }

    async function callAnthropicApiWrapper(messages, config, systemInstruction, tools, forceCalling, signal) {
        const apiKey = state.settings.anthropicApiKey;
        if (!apiKey) { const e = new Error("Anthropic APIキーが設定されていません。設定画面で追加してください。"); e.status = 401; throw e; }

        const effort = state.settings.anthropicEffort || null;
        const useAdaptive = !!effort;
        const useManualThinking = !useAdaptive && state.settings.thinkingBudget > 0;
        const useThinking = useAdaptive || useManualThinking;
        const maxTokens = useAdaptive
            ? Math.max(config.maxOutputTokens ?? 16000, 16000)
            : useManualThinking
                ? Math.max(config.maxOutputTokens ?? 4000, state.settings.thinkingBudget + 1000)
                : config.maxOutputTokens ?? 4000;

        const cacheTTL = state.settings.anthropicCacheTTL || '5m';
        const cacheControl = cacheTTL === 'none' ? null
            : cacheTTL === '1h' ? { type: "ephemeral", ttl: "1h" }
            : { type: "ephemeral" };

        const model = state.settings.modelName || 'claude-opus-4-6';
        const requestBody = {
            model,
            messages: [],
            max_tokens: maxTokens,
        };

        if (useAdaptive) {
            requestBody.thinking = { type: 'adaptive' };
            requestBody.temperature = 1;
        } else if (useManualThinking) {
            requestBody.thinking = { type: 'enabled', budget_tokens: state.settings.thinkingBudget };
            requestBody.temperature = 1;
        } else {
            requestBody.temperature = config.temperature ?? 0.7;
        }
        if (effort) {
            requestBody.output_config = { effort };
        }

        const _staticText = systemInstruction?._staticText;
        const _dynamicText = systemInstruction?._dynamicText;
        if (_staticText !== undefined || _dynamicText !== undefined) {
            // 静的部分（システムプロンプト・ナレッジ）をキャッシュ、動的部分（記憶・サマリー）はキャッシュ対象外
            const blocks = [];
            if (_staticText) {
                const block = { type: "text", text: _staticText };
                if (cacheControl) block.cache_control = cacheControl;
                blocks.push(block);
            }
            if (_dynamicText) blocks.push({ type: "text", text: _dynamicText });
            if (blocks.length > 0) requestBody.system = blocks;
        } else {
            const systemText = extractSystemText(systemInstruction);
            if (systemText) {
                const block = { type: "text", text: systemText };
                if (cacheControl) block.cache_control = cacheControl;
                requestBody.system = [block];
            }
        }

        // Add tools in Anthropic format (input_schema instead of parameters)
        if (tools && tools.length > 0) {
            const convertTypes = (schema) => {
                if (!schema || typeof schema !== 'object') return schema;
                if (Array.isArray(schema)) return schema.map(convertTypes);
                const result = {};
                for (const [key, val] of Object.entries(schema)) {
                    if (key === 'type' && typeof val === 'string') {
                        result[key] = val.toLowerCase();
                    } else if (val && typeof val === 'object') {
                        result[key] = convertTypes(val);
                    } else {
                        result[key] = val;
                    }
                }
                return result;
            };
            const anthropicTools = [];
            for (const toolGroup of tools) {
                for (const decl of (toolGroup.function_declarations || [])) {
                    anthropicTools.push({
                        name: decl.name,
                        description: decl.description || '',
                        input_schema: convertTypes(decl.parameters) || { type: 'object', properties: {} }
                    });
                }
            }
            if (anthropicTools.length > 0) {
                requestBody.tools = anthropicTools;
                // thinking有効時はtool_choice強制不可
                if (forceCalling && !useThinking) {
                    requestBody.tool_choice = { type: 'any' };
                }
            }
        }

        // Convert Gemini-format messages to Anthropic format
        // Anthropic requires strict user/assistant alternation, so consecutive user messages must be merged
        const anthropicMessages = [];
        const pushAnthropicMsg = (role, content) => {
            const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content }];
            if (blocks.length === 0) return;
            const last = anthropicMessages[anthropicMessages.length - 1];
            if (last && last.role === role) {
                // 同じロールが連続した場合はマージ（特にtool_result後のuserメッセージ）
                if (!Array.isArray(last.content)) {
                    last.content = [{ type: 'text', text: last.content }];
                }
                last.content = [...last.content, ...blocks];
            } else {
                anthropicMessages.push({ role, content: blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks });
            }
        };

        for (const geminiMsg of messages) {
            const msgParts = geminiMsg.parts || [];
            if (geminiMsg.role === 'tool') {
                // Tool results → user message with tool_result content blocks
                const toolResultBlocks = [];
                for (const part of msgParts) {
                    if (part.functionResponse) {
                        const toolUseId = part.functionResponse._toolCallId || part.functionResponse.name;
                        const content = typeof part.functionResponse.response === 'string'
                            ? part.functionResponse.response
                            : JSON.stringify(part.functionResponse.response);
                        toolResultBlocks.push({ type: 'tool_result', tool_use_id: toolUseId, content });
                    }
                }
                if (toolResultBlocks.length > 0) pushAnthropicMsg('user', toolResultBlocks);
            } else {
                const role = geminiMsg.role === 'model' ? 'assistant' : 'user';
                const contentBlocks = [];
                for (const part of msgParts) {
                    if (part.text && part.thought !== true) {
                        // 思考ブロックはsignatureなしでは再送できないためスキップ
                        contentBlocks.push({ type: 'text', text: part.text });
                    } else if (part.functionCall) {
                        contentBlocks.push({
                            type: 'tool_use',
                            id: part.functionCall._toolCallId || `toolu_${Date.now()}`,
                            name: part.functionCall.name,
                            input: part.functionCall.args || {}
                        });
                    } else if (part.inlineData) {
                        const mimeType = part.inlineData.mimeType;
                        // data URL prefix ("data:...;base64,") を除去して純粋なbase64を取り出す
                        const rawData = part.inlineData.data.replace(/^data:[^;]+;base64,/, '');
                        if (mimeType.startsWith('image/')) {
                            const ANTHROPIC_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                            if (!ANTHROPIC_IMAGE_TYPES.includes(mimeType)) {
                                const e = new Error(`Anthropic APIはこの画像形式（${mimeType}）に対応していません。JPEG・PNG・GIF・WebP形式に変換してから送信してください。※iPhoneのHEIC画像は、設定→カメラ→フォーマットを「互換性優先」に変更するか、JPEGに変換してください。`);
                                e.status = 400;
                                throw e;
                            }
                            contentBlocks.push({
                                type: 'image',
                                source: { type: 'base64', media_type: mimeType, data: rawData }
                            });
                        } else if (mimeType === 'application/pdf') {
                            contentBlocks.push({
                                type: 'document',
                                source: { type: 'base64', media_type: 'application/pdf', data: rawData }
                            });
                        } else {
                            // テキスト・その他のファイルはデコードしてテキストブロックとして送信
                            try {
                                const decoded = decodeURIComponent(escape(atob(rawData)));
                                contentBlocks.push({ type: 'text', text: decoded });
                            } catch {
                                contentBlocks.push({ type: 'text', text: rawData });
                            }
                        }
                    }
                }
                if (contentBlocks.length > 0) pushAnthropicMsg(role, contentBlocks);
            }
        }
        // Post-process: strip orphaned tool_use blocks (no matching tool_result in next message)
        // This happens when _aggregateMessages merges tool call results into a single model message
        // but discards the intermediate tool response messages from the conversation history.
        for (let i = 0; i < anthropicMessages.length; i++) {
            const msg = anthropicMessages[i];
            if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
            const toolUseIds = msg.content.filter(b => b.type === 'tool_use').map(b => b.id);
            if (toolUseIds.length === 0) continue;

            const nextMsg = anthropicMessages[i + 1];
            const nextContent = nextMsg && Array.isArray(nextMsg.content) ? nextMsg.content : [];
            const toolResultIds = new Set(nextContent.filter(b => b.type === 'tool_result').map(b => b.tool_use_id));
            const orphanedIds = new Set(toolUseIds.filter(id => !toolResultIds.has(id)));
            if (orphanedIds.size === 0) continue;

            const filtered = msg.content.filter(b => !(b.type === 'tool_use' && orphanedIds.has(b.id)));
            if (filtered.length === 0) {
                filtered.push({ type: 'text', text: '(tool execution result incorporated)' });
            }
            msg.content = filtered.length === 1 && filtered[0].type === 'text' ? filtered[0].text : filtered;
        }

        // 会話履歴はトップレベルcache_control（自動キャッシュ）で管理する。
        // これがないと履歴全体が毎ターン通常入力で課金されるため必須。
        // TTLは設定値に従う。返信間隔が5分を超える使い方では1h TTLが必要
        // （5分TTLだとターン毎に履歴全体の再書き込みが発生し、増分書込の節約額を大きく上回る）。
        if (cacheControl && anthropicMessages.length >= 2) {
            requestBody.cache_control = cacheControl;
        }

        anthropicMessages.forEach(msg => requestBody.messages.push(msg));

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(requestBody),
            signal
        });

        if (!response.ok) {
            const err = await response.json().catch(()=>({}));
            const e = new Error(`Anthropic APIエラー: ${err.error?.message || response.statusText}`);
            e.status = response.status;
            throw e;
        }
        const data = await response.json();
        const parts = [];
        for (const block of (data.content || [])) {
            if (block.type === 'thinking' && block.thinking) {
                parts.push({ text: block.thinking, thought: true });
            } else if (block.type === 'text' && block.text) {
                parts.push({ text: block.text });
            } else if (block.type === 'tool_use') {
                // Function call → Gemini functionCall format with _toolCallId
                parts.push({
                    functionCall: {
                        name: block.name,
                        args: block.input,
                        _toolCallId: block.id
                    }
                });
            }
        }
        // Anthropicがコンテンツフィルタリング等で空レスポンスを返した場合（リトライ不要なので400扱い）
        if (parts.length === 0) {
            const stopReason = data.stop_reason || '';
            const errMsg = stopReason === 'max_tokens'
                ? 'Anthropic: トークン上限に達しました。会話履歴を短くするか、max_tokensを増やしてください。'
                : 'Anthropic: 空の応答が返されました。会話内容がコンテンツポリシーに抵触しているか、Claudeがこのシーンに応じられない状態です。';
            const e = new Error(errMsg);
            e.status = 400;
            throw e;
        }
        const geminiFormat = {
            candidates: [{
                content: { parts },
                finishReason: 'STOP'
            }]
        };
        if (data.usage) {
            const cacheWrite = data.usage.cache_creation_input_tokens || 0;
            const cacheRead = data.usage.cache_read_input_tokens || 0;
            const cacheCreation = data.usage.cache_creation || {};
            const cacheWrite5m = cacheCreation.ephemeral_5m_input_tokens ?? (cacheTTL === '1h' ? 0 : cacheWrite);
            const cacheWrite1h = cacheCreation.ephemeral_1h_input_tokens ?? (cacheTTL === '1h' ? cacheWrite : 0);
            const inputTotal = (data.usage.input_tokens || 0) + cacheWrite + cacheRead;
            console.log(`[Cache] cache_write=${cacheWrite} cache_read=${cacheRead} input=${data.usage.input_tokens || 0} output=${data.usage.output_tokens || 0}`);
            geminiFormat.usageMetadata = {
                promptTokenCount: inputTotal,
                candidatesTokenCount: data.usage.output_tokens || 0,
                totalTokenCount: inputTotal + (data.usage.output_tokens || 0),
                cacheCreationInputTokens: cacheWrite,
                cacheReadInputTokens: cacheRead,
                cacheCreation5mInputTokens: cacheWrite5m,
                cacheCreation1hInputTokens: cacheWrite1h
            };
        }
        return { ok: true, status: 200, json: async () => geminiFormat };
    }

    async function callOpenAICompatibleApi(apiKey, baseUrl, providerName, messages, config, systemInstruction, signal) {
        if (!apiKey) { const e = new Error(`${providerName} APIキーが設定されていません。設定画面で追加してください。`); e.status = 401; throw e; }

        const model = state.settings.modelName;
        const isReasoningModel = /r1|reasoner/i.test(model);
        const requestBody = {
            model,
            messages: [],
            max_tokens: config.maxOutputTokens ?? 4000,
            stream: false
        };
        if (!isReasoningModel) {
            requestBody.temperature = config.temperature ?? 0.7;
            requestBody.top_p = config.topP ?? 1.0;
        }

        const systemText = extractSystemText(systemInstruction);
        if (systemText) requestBody.messages.push({ role: 'system', content: systemText });
        apiUtils.convertGeminiToOpenAIFormat(messages).forEach(msg => requestBody.messages.push(msg));

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(requestBody),
            signal
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            const e = new Error(`${providerName} APIエラー: ${err.error?.message || response.statusText}`);
            e.status = response.status;
            throw e;
        }
        const data = await response.json();
        const geminiFormat = apiUtils.convertOpenAIToGeminiFormat(data);
        return { ok: true, status: 200, json: async () => geminiFormat };
    }
})();
