<template>
  <div class="login-page">
    <div class="login-card">
      <h1>AIALL 服务器登录</h1>
      <p class="desc">该服务器已配置访问令牌。请输入 <code>AIALL_SERVER_TOKEN</code> 登录后使用。</p>
      <input
        v-model="password"
        type="password"
        placeholder="AIALL_SERVER_TOKEN"
        autocomplete="current-password"
        @keyup.enter="handleLogin"
      />
      <button type="button" class="primary" :disabled="busy" @click="handleLogin">登录</button>
      <span v-if="error" class="login-error">{{ error }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { serverLogin } from "../services/serverAuth";

const route = useRoute();
const router = useRouter();
const password = ref("");
const busy = ref(false);
const error = ref("");

async function handleLogin() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const result = await serverLogin(password.value.trim());
  busy.value = false;
  if (result.ok) {
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    void router.replace(redirect);
  } else {
    error.value = result.error || "登录失败";
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}
.login-card {
  width: 100%;
  max-width: 360px;
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 12px;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 10px 30px rgba(17, 24, 39, 0.08);
}
.login-card h1 {
  margin: 0;
  font-size: 20px;
}
.login-card .desc {
  margin: 0;
  color: var(--muted, rgba(17, 24, 39, 0.7));
  font-size: 13px;
  line-height: 1.6;
}
.login-card code {
  background: rgba(17, 24, 39, 0.06);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.login-card input {
  padding: 10px 12px;
  border: 1px solid rgba(17, 24, 39, 0.15);
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
}
.login-card .primary {
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  background: var(--primary, rgba(31, 111, 235, 0.9));
  color: #fff;
  font-weight: 600;
}
.login-card .primary:hover:not(:disabled) {
  box-shadow: 0 4px 8px rgba(31, 111, 235, 0.25);
}
.login-card .primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.login-error {
  color: #dc2626;
  font-size: 12px;
}
</style>
