<template>
  <div class="icon-tpl-page">
    <div class="page-head">
      <div>
        <h1>图标模板库</h1>
        <p class="desc">
          录入任务栏/桌面等位置的<strong>小范围截图</strong>；对话里「打开某应用」会按模板在<strong>主显示器画面</strong>范围内匹配并点击。数据仅在运行
          <code class="inline-code">npm run dev</code> 时由本机开发服读写。
        </p>
        <p class="desc subtle">
          库存储：<code class="inline-code">{{ storeHint }}</code>
          · 「AI 识图」使用
          <router-link class="inline-link" to="/ai-config">AI 配置</router-link>
          中保存的接口与模型（需支持图片的多模态模型）。
        </p>
      </div>
      <div class="head-actions">
        <router-link class="secondary link-btn" to="/chat">去对话</router-link>
        <router-link class="secondary link-btn" to="/vibe-coding">Vibe Coding</router-link>
        <router-link class="secondary link-btn" to="/ai-config">AI 配置</router-link>
        <button type="button" class="secondary" :disabled="loading" @click="loadList">刷新</button>
      </div>
    </div>

    <section class="card">
      <h2 class="card-title">{{ editingId ? "编辑条目" : "新建条目" }}</h2>
      <form class="config-form grid-2" @submit.prevent="handleSave">
        <label class="field">
          <span>模板 ID（英文 key）</span>
          <input v-model.trim="form.id" type="text" placeholder="wechat" :disabled="!!editingId" />
          <small class="tips">小写字母、数字、下划线、短横线；创建后不可改。自动化里用此 id 查找模板。</small>
        </label>
        <label class="field">
          <span>显示名称</span>
          <input v-model.trim="form.name" type="text" placeholder="微信" />
        </label>
        <label class="field span-2">
          <span>别名（可选，逗号分隔，用于口语匹配）</span>
          <input v-model.trim="form.aliasesText" type="text" placeholder="WeChat, 威信" />
        </label>
        <label class="field span-2">
          <span>备注</span>
          <input v-model.trim="form.note" type="text" placeholder="例如：任务栏深色主题" />
        </label>

        <div class="field span-2">
          <div class="field-row">
            <span>模板图</span>
            <div class="field-tools">
              <button type="button" class="link" @click="openFilePicker">选择图片</button>
              <button type="button" class="link" :disabled="clipboardLoading" @click="readClipboardImage">
                {{ clipboardLoading ? "读取中…" : "从剪切板读取" }}
              </button>
              <button
                type="button"
                class="link"
                :disabled="aiFillLoading || !canAiFill || !aiConfigReady"
                :title="aiFillDisabledReason"
                @click="handleAiRecognizeFill"
              >
                {{ aiFillLoading ? "识图中…" : "AI 识图" }}
              </button>
              <button type="button" class="link" :disabled="!previewUrl && !form.imageDataUrl" @click="clearPickedImage">
                清除所选文件
              </button>
              <label class="checkbox inline">
                <input v-model="form.clearImage" type="checkbox" />
                <span>保存时移除已存储的图（仅编辑）</span>
              </label>
            </div>
          </div>
          <input ref="fileInputRef" class="file-input" type="file" accept="image/*" @change="onFileChange" />
          <div
            ref="pasteZoneRef"
            class="paste-zone"
            tabindex="0"
            role="region"
            aria-label="模板图：点击从剪切板载入，或 Ctrl+V 粘贴"
            @click="handlePasteZoneClick"
            @paste="handlePasteOnZone"
          >
            <div v-if="previewUrl" class="thumb-wrap">
              <img :src="previewUrl" alt="模板预览" class="thumb" />
            </div>
            <div v-else class="paste-zone-placeholder">
              <span class="paste-zone-title">点击此区域，从剪切板载入截图</span>
              <span class="paste-zone-hint">也可在此处按 Ctrl+V；或使用上方「选择图片」</span>
            </div>
          </div>
          <small v-if="previewUrl && editingId && currentImageUrl" class="tips">将用当前预览覆盖服务器上的旧图。</small>
          <small v-else-if="!previewUrl && editingId && currentImageUrl" class="tips">当前已存图见下方列表；粘贴或上传新图将覆盖。</small>
          <small v-else-if="!previewUrl" class="tips">裁好的小图（仅图标区域）。点击模板区域或上方「从剪切板读取」均可载入剪切板图片；页面空白处 Ctrl+V 亦可（输入框内仍为文字粘贴）。新建必须提供图。</small>
        </div>

        <div class="actions span-2">
          <button type="submit" class="primary" :disabled="saving">
            {{ saving ? "保存中…" : "保存" }}
          </button>
          <button v-if="editingId" type="button" class="secondary" @click="cancelEdit">取消编辑</button>
        </div>
        <p v-if="formError" class="tips error span-2">{{ formError }}</p>
        <p v-if="saveOk" class="tips ok span-2">{{ saveOk }}</p>
      </form>
    </section>

    <section class="card">
      <h2 class="card-title">已录入列表</h2>
      <p v-if="loadError" class="tips error">加载失败：{{ loadError }}</p>
      <div v-if="loading && !items.length" class="tips">加载中…</div>
      <div v-else-if="!items.length" class="tips">暂无条目，请在上方新建。</div>
      <ul v-else class="item-list">
        <li v-for="row in items" :key="row.id" class="item-row">
          <div class="item-main">
            <div class="item-id">
              <code class="inline-code">{{ row.id }}</code>
              <span class="item-name">{{ row.name }}</span>
            </div>
            <div v-if="row.aliases?.length" class="item-meta">别名：{{ row.aliases.join("，") }}</div>
            <div v-if="row.note" class="item-meta">{{ row.note }}</div>
            <div v-if="screenDebugHint[row.id]" class="item-meta debug-line">{{ screenDebugHint[row.id] }}</div>
          </div>
          <div class="item-thumb" @click="row.imageUrl && openPreview(row.imageUrl)">
            <img v-if="row.imageUrl" :src="row.imageUrl" alt="" />
            <span v-else class="no-img">无图</span>
          </div>
          <div class="item-actions">
            <button
              type="button"
              class="secondary"
              :disabled="!row.imageUrl || screenDebugLoadingId === row.id"
              :title="row.imageUrl ? '截取当前主显示器画面并在其中查找该模板（不点击）' : '请先为该条目保存模板图'"
              @click="testScreenMatch(row)"
            >
              {{ screenDebugLoadingId === row.id ? "测试中…" : "屏幕调试" }}
            </button>
            <button type="button" class="secondary" @click="startEdit(row)">编辑</button>
            <button type="button" class="secondary danger" :disabled="deletingId === row.id" @click="handleDelete(row.id)">
              {{ deletingId === row.id ? "删除中…" : "删除" }}
            </button>
          </div>
            <div v-if="screenDebugCapture[row.id]" class="item-screen-capture">
            <div class="screen-debug-cap-title">
              本次匹配使用的截屏（主显示器，与算法一致）。长图可在此区域上下滚动；点击图可在新标签页看原图。
            </div>
            <div class="screen-debug-cap-frame">
              <img
                :src="screenDebugCapture[row.id]"
                alt="主显示器截屏"
                class="screen-debug-cap-img"
                title="点击新标签页打开原图"
                @click="openScreenDebugFull(row.id)"
              />
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { IconTemplateItem } from "../types/iconTemplates";
import {
  deleteIconTemplate,
  fetchIconTemplateList,
  testIconTemplateMatch,
  upsertIconTemplate,
} from "../services/iconTemplatesClient";
import { testAiModel } from "../services/aiClient";
import { loadAiChatBaseFromStorage } from "../services/aiLocalConfig";
import { extractAssistantTextFromChatResponseJson, parseJsonObjectFromModelText } from "../utils/chatCompletionText";

const loading = ref(false);
const loadError = ref("");
const items = ref<Array<IconTemplateItem & { imageUrl: string | null }>>([]);
const storeHint = ref("data/icon-templates/store.json");

const form = ref({
  id: "",
  name: "",
  aliasesText: "",
  note: "",
  imageDataUrl: "" as string,
  clearImage: false,
});

const editingId = ref("");
const previewUrl = computed(() => form.value.imageDataUrl || "");
const fileInputRef = ref<HTMLInputElement | null>(null);

const saving = ref(false);
const formError = ref("");
const saveOk = ref("");
const deletingId = ref("");
/** 列表项「屏幕调试」：提示文案与整屏预览 data URL */
const screenDebugHint = ref<Record<string, string>>({});
const screenDebugCapture = ref<Record<string, string>>({});
const screenDebugLoadingId = ref("");
const clipboardLoading = ref(false);
const pasteZoneRef = ref<HTMLElement | null>(null);
const aiFillLoading = ref(false);

const currentImageUrl = computed(() => {
  if (!editingId.value) return "";
  const row = items.value.find((x) => x.id === editingId.value);
  return row?.imageUrl || "";
});

const aiConfigReady = computed(() => {
  const c = loadAiChatBaseFromStorage();
  return Boolean(c?.endpoint?.trim() && c?.model?.trim());
});

/** 新建：须本地预览图；编辑：预览或列表里已有图均可用于识图 */
const canAiFill = computed(() => {
  if (previewUrl.value) return true;
  if (editingId.value && currentImageUrl.value) return true;
  return false;
});

const aiFillDisabledReason = computed(() => {
  if (!canAiFill.value) return "请先提供模板图，或编辑一条已有缩略图的条目";
  if (!aiConfigReady.value) return "请先在「AI 配置」保存接口地址与多模态模型";
  return "";
});

async function loadList() {
  loading.value = true;
  loadError.value = "";
  try {
    const res = await fetchIconTemplateList();
    items.value = res.items;
    storeHint.value = `${res.storePath} + ${res.imagesPath}`;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function openFilePicker() {
  fileInputRef.value?.click();
}

/** 点击模板区域：与「从剪切板读取」相同，直接读剪切板图片 */
function handlePasteZoneClick() {
  void readClipboardImage();
  pasteZoneRef.value?.focus();
}

/** 从 ClipboardEvent 的 clipboardData 中取首张图片（Ctrl+V 同源路径） */
function applyClipboardEventImage(ev: ClipboardEvent): boolean {
  const items = ev.clipboardData?.items;
  if (!items?.length) return false;
  const imageItem = Array.from(items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
  const file = imageItem?.getAsFile();
  if (!file) return false;
  void setImageFromFile(file);
  return true;
}

function setImageFromFile(file: File): Promise<void> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      formError.value = "请使用图片文件（PNG/JPEG/WebP 等）";
      resolve();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") {
        form.value.imageDataUrl = r;
        form.value.clearImage = false;
        formError.value = "";
      }
      resolve();
    };
    reader.onerror = () => {
      formError.value = "读取图片失败";
      resolve();
    };
    reader.readAsDataURL(file);
  });
}

function handlePasteOnZone(ev: ClipboardEvent) {
  if (applyClipboardEventImage(ev)) {
    ev.preventDefault();
  }
}

function handleWindowPaste(ev: ClipboardEvent) {
  const t = ev.target;
  if (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  ) {
    return;
  }
  if (t instanceof HTMLElement && t.isContentEditable) return;
  if (!applyClipboardEventImage(ev)) return;
  ev.preventDefault();
}

async function readClipboardImage() {
  formError.value = "";
  if (typeof navigator.clipboard?.read !== "function") {
    formError.value = "当前浏览器不支持主动读取剪切板，请点击模板区域后使用 Ctrl+V。";
    return;
  }
  clipboardLoading.value = true;
  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      for (const type of item.types) {
        if (!type.startsWith("image/")) continue;
        const blob = await item.getType(type);
        const ext = type === "image/png" ? "png" : type === "image/jpeg" || type === "image/jpg" ? "jpg" : "png";
        const file = new File([blob], `clipboard.${ext}`, { type: blob.type || type });
        await setImageFromFile(file);
        if (form.value.imageDataUrl) return;
      }
    }
    formError.value = "剪切板里没有图片。";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    formError.value =
      msg.includes("denied") || msg.includes("权限")
        ? "读取剪切板被拒绝，请在浏览器提示中允许，或使用 Ctrl+V。"
        : `读取剪切板失败：${msg}`;
  } finally {
    clipboardLoading.value = false;
  }
}

/** 识图填充：要求模型只输出 JSON，便于解析 */
const ICON_RECOGNIZE_PROMPT = [
  "这是一张桌面或任务栏等区域的应用图标截图（可能含多个图标，请判断用户最想标识的那一个，通常是截图主体）。",
  "请识别对应的应用程序，并只输出一个 JSON 对象，不要 markdown 代码围栏，不要其它说明文字。字段要求：",
  '{"id":"英文小写标识，如 wechat，仅字母数字下划线连字符","name":"常用显示名（中文或英文）","aliases":["口语别名1","别名2"],"note":"简短说明，如 任务栏固定图标"}',
  "id 尽量简短；aliases 为数组，没有则 []；note 没有则空字符串。",
  "若无法判断应用，id 填 unknown_app，name 填「未识别」，aliases 为 []，note 说明原因。",
].join("\n");

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("图片读取失败"));
    r.readAsDataURL(blob);
  });
}

async function resolveImageDataUrlForAi(): Promise<string | null> {
  if (form.value.imageDataUrl) return form.value.imageDataUrl;
  const url = currentImageUrl.value;
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function sanitizeTemplateId(raw: string): string {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
  if (!s) return "";
  if (!/^[a-z0-9]/.test(s)) {
    s = `app_${s.replace(/^[^a-z0-9]+/, "") || "icon"}`;
  }
  return s.slice(0, 64);
}

function applyRecognizedPayload(data: unknown) {
  if (!data || typeof data !== "object") {
    throw new Error("模型返回不是 JSON 对象");
  }
  const o = data as Record<string, unknown>;
  if (!editingId.value) {
    const sid = sanitizeTemplateId(o.id != null ? String(o.id) : "");
    if (sid) form.value.id = sid;
  }
  if (o.name != null && String(o.name).trim()) {
    form.value.name = String(o.name).trim().slice(0, 80);
  }
  if (Array.isArray(o.aliases)) {
    form.value.aliasesText = o.aliases
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .slice(0, 32)
      .join(", ");
  } else if (typeof o.aliases === "string") {
    form.value.aliasesText = String(o.aliases).trim().slice(0, 500);
  }
  if (o.note != null) {
    form.value.note = String(o.note).trim().slice(0, 500);
  }
}

async function handleAiRecognizeFill() {
  formError.value = "";
  saveOk.value = "";
  const cfg = loadAiChatBaseFromStorage();
  if (!cfg?.endpoint?.trim() || !cfg?.model?.trim()) {
    formError.value = "请先在「AI 配置」页保存接口地址与模型（须支持图片的多模态模型）。";
    return;
  }
  const imageDataUrl = await resolveImageDataUrlForAi();
  if (!imageDataUrl) {
    formError.value = "没有可用的模板图：请先粘贴/上传，或编辑一条带缩略图的条目。";
    return;
  }
  aiFillLoading.value = true;
  try {
    const res = await testAiModel({
      endpoint: cfg.endpoint.trim(),
      apiKey: cfg.apiKey,
      model: cfg.model.trim(),
      prompt: ICON_RECOGNIZE_PROMPT,
      imageDataUrl,
      stream: false,
    });
    if (!res.ok) {
      formError.value = res.error || res.rawText?.slice(0, 400) || `请求失败 HTTP ${res.status}`;
      return;
    }
    let inner = extractAssistantTextFromChatResponseJson(res.rawText);
    if (!inner && res.parsed && typeof res.parsed === "object") {
      const p = res.parsed as { choices?: Array<{ message?: { content?: string } }> };
      inner = p.choices?.[0]?.message?.content?.trim() || "";
    }
    if (!inner) {
      formError.value = "接口未返回可解析的正文，请确认模型支持视觉且接口兼容 OpenAI Chat。";
      return;
    }
    let parsedJson: unknown;
    try {
      parsedJson = parseJsonObjectFromModelText(inner);
    } catch (e) {
      formError.value = e instanceof Error ? e.message : "解析 JSON 失败";
      return;
    }
    applyRecognizedPayload(parsedJson);
    saveOk.value = "已根据识图结果填充，请核对后再保存。";
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e);
  } finally {
    aiFillLoading.value = false;
  }
}

function onFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  void setImageFromFile(file);
  input.value = "";
}

function clearPickedImage() {
  form.value.imageDataUrl = "";
}

function startEdit(row: IconTemplateItem & { imageUrl: string | null }) {
  editingId.value = row.id;
  form.value = {
    id: row.id,
    name: row.name,
    aliasesText: row.aliases?.length ? row.aliases.join(", ") : "",
    note: row.note || "",
    imageDataUrl: "",
    clearImage: false,
  };
  formError.value = "";
  saveOk.value = "";
}

function cancelEdit() {
  editingId.value = "";
  form.value = {
    id: "",
    name: "",
    aliasesText: "",
    note: "",
    imageDataUrl: "",
    clearImage: false,
  };
  formError.value = "";
}

async function handleSave() {
  formError.value = "";
  saveOk.value = "";
  saving.value = true;
  try {
    const aliases = form.value.aliasesText
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const id = editingId.value || form.value.id.trim().toLowerCase();
    await upsertIconTemplate({
      id,
      name: form.value.name.trim(),
      aliases,
      note: form.value.note.trim(),
      imageBase64: form.value.imageDataUrl || undefined,
      clearImage: form.value.clearImage,
    });
    saveOk.value = "已保存。";
    await loadList();
    if (!editingId.value) {
      cancelEdit();
    }
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

/** 与后端 MatchAlgorithm 对应的中文说明 */
const MATCH_ALGO_LABEL: Record<string, string> = {
  rgba_smart_probe_reservoir: "RGBA 智能探针 + 蓄水池 + 整图一致比例",
  rgba_legacy_probe_reservoir: "RGBA 两轮固定探针 + 蓄水池 + 整图一致比例",
  rgb_tolerant_sparse_sad: "RGB 容错探针候选 + 完整相似度验证",
  rgb_tolerant_multiscale_sad: "RGB 容错探针候选 + 多尺度完整相似度验证",
};

function matchAlgorithmLabel(code: string): string {
  return MATCH_ALGO_LABEL[code] || code;
}

function openScreenDebugFull(id: string) {
  const u = screenDebugCapture.value[id];
  if (u) window.open(u, "_blank", "noopener,noreferrer");
}

async function testScreenMatch(row: IconTemplateItem & { imageUrl: string | null }) {
  if (!row.imageUrl) return;
  screenDebugLoadingId.value = row.id;
  const hintNext = { ...screenDebugHint.value };
  delete hintNext[row.id];
  screenDebugHint.value = hintNext;
  const capNext = { ...screenDebugCapture.value };
  delete capNext[row.id];
  screenDebugCapture.value = capNext;
  try {
    const r = await testIconTemplateMatch(row.id);
    const capUrl = r.screenPngBase64 ? `data:image/png;base64,${r.screenPngBase64}` : "";
    if (r.ok) {
      screenDebugHint.value = {
        ...screenDebugHint.value,
        [row.id]: `已匹配：得分 ${r.score.toFixed(3)}（当前算法相似度，0～1）。采用：${matchAlgorithmLabel(r.matchAlgorithm)} [${r.matchAlgorithm}]。左上 (${r.topLeftX}, ${r.topLeftY})；建议点击 (${r.clickX}, ${r.clickY})（未执行点击）。`,
      };
      if (capUrl) {
        screenDebugCapture.value = { ...screenDebugCapture.value, [row.id]: capUrl };
      }
    } else {
      screenDebugHint.value = {
        ...screenDebugHint.value,
        [row.id]: `未匹配或失败：${r.error}`,
      };
      if (capUrl) {
        screenDebugCapture.value = { ...screenDebugCapture.value, [row.id]: capUrl };
      }
    }
  } finally {
    screenDebugLoadingId.value = "";
  }
}

async function handleDelete(id: string) {
  if (!confirm(`确定删除模板「${id}」？`)) return;
  deletingId.value = id;
  try {
    await deleteIconTemplate(id);
    await loadList();
    if (editingId.value === id) cancelEdit();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    deletingId.value = "";
  }
}

function openPreview(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

onMounted(() => {
  loadList();
  window.addEventListener("paste", handleWindowPaste);
});

onBeforeUnmount(() => {
  window.removeEventListener("paste", handleWindowPaste);
});
</script>

<style scoped>
.icon-tpl-page {
  --bg: #ffffff;
  --text: #111827;
  --muted: rgba(17, 24, 39, 0.72);
  --subtle: rgba(17, 24, 39, 0.56);
  --border: rgba(17, 24, 39, 0.12);
  --primary: #1f6feb;
  --danger: #cf222e;
  --ok: #1a7f37;
  --card-shadow: 0 10px 30px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(15, 23, 42, 0.05);

  max-width: 980px;
  margin: 0 auto;
  padding: 22px 18px 40px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans", "Liberation Sans",
    sans-serif;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.page-head h1 {
  margin: 0;
  font-size: 22px;
}

.desc {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
}

.desc.subtle {
  font-size: 13px;
  color: var(--subtle);
}

.inline-link {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.inline-link:hover {
  opacity: 0.88;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.link-btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
}

.secondary {
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
}

.secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.secondary.danger {
  border-color: rgba(207, 34, 46, 0.35);
  color: var(--danger);
}

.primary {
  padding: 8px 18px;
  border-radius: 10px;
  border: none;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.card {
  margin-top: 16px;
  padding: 18px 18px 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg);
  box-shadow: var(--card-shadow);
}

.card-title {
  margin: 0 0 14px;
  font-size: 16px;
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 720px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: span 1 !important;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field.span-2 {
  grid-column: span 2;
}

.field > span {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}

.field input,
.field .tpl-select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  font-size: 14px;
}

.field .tpl-select {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}

.field input:disabled {
  opacity: 0.65;
  background: rgba(17, 24, 39, 0.04);
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.field-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--primary);
  cursor: pointer;
  font-size: 13px;
}

.inline-code {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(17, 24, 39, 0.06);
  font-size: 12px;
}

.tips {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
}

.tips.error {
  color: var(--danger);
}

.tips.ok {
  color: var(--ok);
}

.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.paste-zone {
  margin-top: 8px;
  min-height: 96px;
  border-radius: 12px;
  border: 1px dashed var(--border);
  padding: 12px;
  outline: none;
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.paste-zone:focus-visible {
  border-color: rgba(31, 111, 235, 0.55);
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.18);
}

.paste-zone-placeholder {
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
  min-height: 72px;
  text-align: center;
}

.paste-zone-title {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}

.paste-zone-hint {
  font-size: 12px;
  color: var(--muted);
}

.thumb-wrap {
  margin-top: 0;
}

.thumb {
  max-width: 160px;
  max-height: 160px;
  border-radius: 8px;
  border: 1px solid var(--border);
  object-fit: contain;
  background: rgba(17, 24, 39, 0.03);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.checkbox.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}

.item-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.02);
}

.item-screen-capture {
  grid-column: 1 / -1;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}

.screen-debug-cap-title {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
  line-height: 1.45;
}

/* 可滚动，避免长截图被 max-height 裁成「显示不全」的错觉 */
.screen-debug-cap-frame {
  max-height: min(80vh, 1200px);
  overflow: auto;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(17, 24, 39, 0.04);
}

.screen-debug-cap-img {
  display: block;
  width: 100%;
  height: auto;
  vertical-align: top;
  cursor: zoom-in;
}

@media (max-width: 720px) {
  .item-row {
    grid-template-columns: 1fr;
  }
}

.item-id {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.item-name {
  font-weight: 600;
}

.item-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.item-meta.debug-line {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(31, 111, 235, 0.08);
  color: var(--text);
  line-height: 1.45;
}

.item-thumb {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.04);
  cursor: pointer;
}

.item-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.no-img {
  font-size: 11px;
  color: var(--subtle);
}

.item-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

@media (prefers-color-scheme: dark) {
  .icon-tpl-page {
    --bg: rgba(17, 24, 39, 0.78);
    --text: rgba(255, 255, 255, 0.92);
    --muted: rgba(255, 255, 255, 0.72);
    --subtle: rgba(255, 255, 255, 0.6);
    --border: rgba(255, 255, 255, 0.14);
    --card-shadow: 0 18px 44px rgba(0, 0, 0, 0.35), 0 2px 10px rgba(0, 0, 0, 0.2);
  }

  .card {
    background: rgba(17, 24, 39, 0.72);
  }

  .field input,
  .field .tpl-select {
    background: rgba(2, 6, 23, 0.55);
    color: rgba(255, 255, 255, 0.92);
    border-color: rgba(255, 255, 255, 0.16);
  }

  .inline-code {
    background: rgba(255, 255, 255, 0.08);
  }

  .item-row {
    background: rgba(0, 0, 0, 0.12);
  }

  .item-meta.debug-line {
    background: rgba(31, 111, 235, 0.14);
    color: rgba(255, 255, 255, 0.88);
  }

  .link-btn,
  .secondary {
    background: rgba(17, 24, 39, 0.72);
    color: rgba(255, 255, 255, 0.9);
    border-color: rgba(255, 255, 255, 0.14);
  }
}
</style>
