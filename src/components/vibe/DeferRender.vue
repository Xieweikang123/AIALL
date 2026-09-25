<template>
  <div
    ref="hostRef"
    class="defer-render"
    :style="placeholderStyle"
  >
    <slot v-if="shouldRender" />
    <!--
      离屏占位：不渲染真实内容，只撑住上次量到的高度。
      用固定高度而非估算，避免滚动条在滚动过程中跳动；
      首次从未量到高度时给一个保守的 minHeight，防止塌成 0 造成页面跳跃。
    -->
    <div v-else-if="placeholderLabel" class="defer-render-placeholder" aria-hidden="true">
      {{ placeholderLabel }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 离屏延迟渲染（过程 feed 虚拟化用）。
 *
 * 背景：二分实测（`tab-ablation.log`）显示，切到长会话时首帧 ~320ms，
 * 其中 ~95% 来自 `AgentMessage` 的过程 feed 树。这些 feed 树对每条消息各建一棵，
 * 12 条消息就有 12 棵（每棵含 8~13 轮 reasoning + 工具步骤行），
 * 即使它们在视口外、用户根本看不见。
 *
 * 这里用 IntersectionObserver 判断「是否接近视口」：
 *  - 接近 → 渲染真实内容（slot）
 *  - 离屏 → 只留一个按上次量到高度撑开的占位
 *
 * 为什么用 IntersectionObserver 而不是自己算滚动：
 * 消息列表共用上层 `.chat-scroll` 这一个滚动容器（`.agent-stream` 自身没有 overflow），
 * 各 feed 实例拿不到自己在滚动容器里的位置；IO 天然跨层级、无需知道谁是滚动祖先。
 *
 * 一次性放行（onceVisible）：一旦进过视口就永久保留真实内容，
 * 避免用户来回滚动时反复挂载/卸载造成闪烁与状态丢失。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    /** 占位文案；留空则不渲染占位块（仅靠 minHeight 撑开）。 */
    placeholderLabel?: string;
    /** 距视口多远就开始渲染（px）。提前渲染可避免滚动时看到占位。 */
    rootMargin?: string;
    /** 进过视口后是否永久保留渲染（默认 true）。 */
    once?: boolean;
    /** 预估高度，用于首次离屏时撑开（px）。 */
    estimatedHeight?: number;
    /**
     * 强制渲染：为 true 时无条件渲染真实内容（如 Agent 正在跑的消息）。
     * 活态内容必须实时渲染，延迟会造成步骤推进「看不见」。
     */
    eager?: boolean;
  }>(),
  {
    placeholderLabel: "",
    rootMargin: "600px 0px",
    once: true,
    estimatedHeight: 0,
    eager: false,
  },
);

const hostRef = ref<HTMLElement | null>(null);
const visible = ref(false);
/** 上次量到的高度：离屏后按它撑开，滚动条不跳。 */
const measuredHeight = ref(0);

/** eager 时始终渲染（活态内容不能被延迟）。 */
const shouldRender = computed(() => props.eager || visible.value);

let observer: IntersectionObserver | null = null;

const placeholderStyle = computed(() => {
  if (shouldRender.value) return undefined;
  const h = measuredHeight.value || props.estimatedHeight;
  return h > 0 ? { minHeight: `${h}px` } : undefined;
});

function measure() {
  const el = hostRef.value;
  if (!el) return;
  const h = el.offsetHeight;
  if (h > 0) measuredHeight.value = h;
}

onMounted(() => {
  const el = hostRef.value;
  if (!el) {
    visible.value = true;
    return;
  }
  // 无 IntersectionObserver（老环境/测试）时直接渲染，保证功能不丢
  if (typeof IntersectionObserver === "undefined") {
    visible.value = true;
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.value = true;
          if (props.once) {
            observer?.disconnect();
            observer = null;
          }
          // 渲染后量一次真实高度，供将来离屏时撑开
          requestAnimationFrame(measure);
        } else if (!props.once) {
          // 重复模式：离屏前先记住高度，再卸载内容
          measure();
          visible.value = false;
        }
      }
    },
    { rootMargin: props.rootMargin },
  );
  observer.observe(el);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<style scoped>
.defer-render {
  min-width: 0;
}

.defer-render-placeholder {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  border-left: 2px solid rgba(148, 163, 184, 0.18);
  color: rgba(148, 163, 184, 0.5);
  font-size: 11px;
  line-height: 1.6;
}
</style>
