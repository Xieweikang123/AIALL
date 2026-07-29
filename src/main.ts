import { createApp } from 'vue'
import './assets/scrollbar.css'
import 'highlight.js/styles/github-dark.css'
import App from './App.vue'
import router from './router'

createApp(App).use(router).mount('#app')
