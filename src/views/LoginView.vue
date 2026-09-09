<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background: radial-gradient(700px 400px at 20% 10%, rgba(31, 111, 235, 0.1), transparent 60%),
    #000000;
}
.login-card {
  width: 100%;
  max-width: 360px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #0a0a0a;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
  color: rgba(255, 255, 255, 0.92);
}
.login-card h1 {
  margin: 0;
  font-size: 20px;
}
.login-card .desc {
  margin: 0;
  color: rgba(255, 255, 255, 0.62);
  font-size: 13px;
  line-height: 1.6;
}
.login-card code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}
.login-card input {
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  font-size: 14px;
  background: #050505;
  color: rgba(255, 255, 255, 0.92);
  outline: none;
}
.login-card input:focus {
  border-color: rgba(88, 166, 255, 0.6);
}
.login-card .primary {
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  background: var(--primary, #1f6feb);
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
.login-card .primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.login-error {
  color: #ff7b72;
  font-size: 12px;
}
</style>