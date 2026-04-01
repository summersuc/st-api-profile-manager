# API管家 for SillyTavern

一个面向手机使用场景的 SillyTavern 第三方扩展，用来集中保存多个 API 配置、按分组管理同一接口地址下的不同模型，并快速切换当前使用的接口方案。

## 现在的界面长什么样

- 右下角有一个小入口按钮：**API管家**
- 点击后会打开一个**独立底部面板**，而不是在 API 页面里铺开一整张大表单
- 首页是**配置分组列表**
- 进入分组后，可以看到这个分组下的多个配置
- 每个配置支持：
  - 启用
  - 编辑
  - 复制
  - 删除

## 主要功能

- 保存多个 API 配置
- 支持同一接口地址下保存多个模型配置
- 支持分组管理
- 快速切换当前启用的配置
- 支持导入备份
- 支持明文导出 JSON
- 支持加密导出备份
- 支持默认隐藏 API 密钥

## 目前支持的自动应用目标

### 聊天补全

- `custom`
- `openai`
- `azure_openai`

### 文本生成

- `generic`
- `ooba`
- `vllm`
- `aphrodite`
- `tabby`
- `koboldcpp`
- `llamacpp`
- `ollama`
- `huggingface`

插件启用配置时，会按这些类型把地址 / 密钥写回 SillyTavern 当前页面已有的接口设置字段，并尝试触发连接。

## 安装方式

1. 在 SillyTavern 中打开 **Extensions**
2. 在 **Install extension** 里粘贴仓库地址
3. 安装并启用扩展
4. 到 API 页面右下角找到 **API管家** 按钮

当前仓库地址：

- `https://github.com/summersuc/st-api-profile-manager`

## 重要说明

这是一个**前端 UI 扩展**，不是安全保险箱。

- API 密钥仍然保存在 SillyTavern 的客户端扩展设置中
- “默认隐藏密钥”只是隐藏显示
- “加密导出”只保护导出的备份文件
- 并不会把 SillyTavern 当前存储变成真正的安全密钥库

如果你之后想要更强的安全性，需要再做服务端插件或外部密钥管理方案。
