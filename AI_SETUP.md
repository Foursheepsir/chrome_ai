# Chrome AI Summarizer API 使用指南

## 功能说明

现在扩展已集成 Chrome 内置的 Summarizer API，使用 Gemini Nano 模型生成高质量的文本摘要。

**参考文档**: [Chrome Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api)

## 前置要求

### 1. Chrome 版本要求

- **推荐**: Chrome 138+ stable
- **或**: Chrome Canary/Dev 版本

### 2. 启用 Feature Flags

1. 打开 Chrome 浏览器，访问：`chrome://flags`

2. 搜索并启用以下 flags：
   
   - **Summarization API for Gemini Nano**
     - Flag: `#summarization-api-for-gemini-nano`
     - 设置为: `Enabled Multilingual`
   
   - **Optimization Guide On Device Model**
     - Flag: `#optimization-guide-on-device-model`
     - 设置为: `Enabled BypassPerfRequirement`

3. **重启浏览器** (必需)

### 3. 下载 Gemini Nano 模型

1. 访问：`chrome://components`

2. 找到 **Optimization Guide On Device Model** 组件

3. 点击 **Check for update** 下载模型（约 1.7GB）

4. 等待下载完成

**提示**: 也可以在首次调用 `Summarizer.create()` 时自动下载模型

## 测试 API 是否可用

### 方法 1：自动诊断（推荐）

扩展会在页面加载时自动运行诊断。打开任意网页，按 **F12** 打开控制台，查看输出：

```
=== Chrome AI Diagnostic ===
User Agent: ...
Chrome Version: ...

1. Checking Summarizer API...
✅ Summarizer API found

2. Checking availability...
Status: available
✅ Summarizer is ready to use!

3. Testing instance creation...
✅ Successfully created Summarizer instance!
=== End Diagnostic ===
```

### 方法 2：手动测试

打开浏览器控制台（F12），输入：

```javascript
// 检查 API 是否存在
console.log('Summarizer API:', 'Summarizer' in self)

// 检查可用性
if ('Summarizer' in self) {
  Summarizer.availability().then(status => {
    console.log('Status:', status)
    // 可能的值: 'available', 'downloadable', 'downloading', 'unavailable'
  })
}

// 测试创建实例
const summarizer = await Summarizer.create({
  type: 'tldr',
  length: 'short'
})
console.log('Created:', summarizer)
```

## 使用扩展功能

一旦 API 可用，扩展会自动使用真实的 AI 功能：

### 1. 选中文本摘要
- 在任何网页选中文本
- 点击 **Summarize** 按钮
- 将使用 Chrome AI 生成摘要（如果可用）
- 如果 API 不可用，会降级到简单截断方案

### 2. 整页摘要
- 点击页面悬浮球
- 打开侧边栏查看整页摘要
- 真实 AI 生成的摘要质量更高

### 3. 解释功能
- 选中术语或短语
- 点击 **Explain** 按钮
- 使用 AI 根据上下文生成解释

## 控制台日志说明

扩展会输出详细的 AI 使用状态：

**检测阶段**:
- `[AI] ✅ Summarizer API found` - API 已找到
- `[AI] Summarizer status: available` - 可以使用
- `[AI] Model download progress: 45%` - 模型下载进度

**使用阶段**:
- `[AI] Creating Summarizer instance...` - 创建实例
- `[AI] Using Chrome AI Summarizer API` - 使用真实 AI
- `[AI] Using fallback summarization` - 使用降级方案

## 故障排除

### 问题 1: API 未找到
**症状**: `❌ Summarizer API not found in global scope`

**解决方案**:
1. 确认 Chrome 版本 >= 138 (或 Canary/Dev)
2. 访问 `chrome://flags` 启用必要的 flags
3. 重启浏览器
4. 清除缓存后重试

### 问题 2: Status 显示 'unavailable'
**症状**: `Status: unavailable`

**解决方案**:
1. 检查磁盘空间 (至少 22GB)
2. 检查硬件要求:
   - GPU: >4GB VRAM
   - 或 CPU: 16GB+ RAM + 4+ cores
3. 访问 `chrome://on-device-internals` 查看详细信息

### 问题 3: 模型下载失败
**症状**: `Status: downloadable` 但无法创建实例

**解决方案**:
1. 确保网络无计量限制 (不要用手机热点)
2. 访问 `chrome://components` 手动更新模型
3. 等待下载完成后重试

### 问题 4: 仍使用降级方案
**症状**: `Using fallback summarization`

**解决方案**:
1. 打开控制台查看完整错误信息
2. 运行自动诊断检查每个步骤
3. 确认模型状态为 `available`
4. 尝试在新的隐身窗口测试

## 技术细节

### API 配置

扩展使用以下配置创建 Summarizer：

```javascript
const options = {
  sharedContext: 'General purpose text summarization for web content',
  type: 'tldr',  // 类型: tldr, key-points, teaser, headline
  length: 'medium',  // 长度: short, medium, long (根据 maxWords 自动选择)
  format: 'plain-text',  // 格式: plain-text, markdown
  expectedInputLanguages: ['en-US'],  // 可选：期望输入语言
  outputLanguage: 'en-US',  // 可选：输出语言
  monitor(m) {
    // 监听模型下载进度
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded * 100}%`)
    })
  }
}

const summarizer = await Summarizer.create(options)
```

### 摘要类型

| Type | 描述 | 长度 (short/medium/long) |
|------|------|--------------------------|
| `tldr` | 简短概述 | 1句/3句/5句 |
| `key-points` | 要点列表 | 3点/5点/7点 |
| `teaser` | 吸引性摘要 | 1句/3句/5句 |
| `headline` | 标题式摘要 | 12词/17词/22词 |

### 实例管理

- ✅ **实例缓存**: Summarizer 实例会被缓存，避免重复创建
- ✅ **自动清理**: 页面卸载时自动调用 `destroy()`
- ✅ **优雅降级**: API 不可用时自动切换到文本截断
- ✅ **下载监控**: 实时显示模型下载进度

### API 调用示例

```javascript
// 批量摘要
const summary = await summarizer.summarize(text, {
  context: '这是一篇技术文章'
})

// 流式摘要 (实时生成)
const stream = summarizer.summarizeStreaming(text)
for await (const chunk of stream) {
  console.log(chunk)
}

// 清理资源
summarizer.destroy()
```

## 参考资源

- 📘 [Chrome Summarizer API 官方文档](https://developer.chrome.com/docs/ai/summarizer-api)
- 🎮 [Summarizer API Playground](https://developer.chrome.com/docs/ai/summarizer-api#demo)
- 🏠 [Built-in AI on Chrome](https://developer.chrome.com/docs/ai/built-in)
- 🔧 [On-Device Internals](chrome://on-device-internals)

## 注意事项

### ✅ 生产就绪
- Chrome 138+ stable 已支持
- API 相对稳定，可用于生产环境
- 建议配合降级方案使用

### ⚠️ 限制
- 仅支持桌面平台 (Windows/macOS/Linux/ChromeOS)
- 移动端暂不支持
- 需要满足硬件要求
- 首次使用需下载模型 (约 1.7GB)

### 💡 最佳实践
- 清理 HTML 标签，使用 `innerText` 提取纯文本
- 为长文本提供 `context` 提高摘要质量
- 使用流式 API 提升用户体验
- 始终提供降级方案

