# 贡献指南

感谢你对PicG项目的关注！我们欢迎所有形式的贡献。

## 🤝 如何贡献

### 报告问题
- 使用 [Issues](https://github.com/lfkdsk/PictorG/issues) 报告bug
- 提供详细的复现步骤
- 包含错误截图或日志

### 功能建议
- 在 [Discussions](https://github.com/lfkdsk/PictorG/discussions) 中讨论新功能
- 描述功能的使用场景和价值

### 代码贡献

#### 开发环境设置
1. Fork项目到你的GitHub账号
2. 克隆你的fork：
   ```bash
   git clone https://github.com/<your-username>/PictorG.git
   cd PictorG
   ```
3. 安装依赖：
   ```bash
   npm install
   ```
4. 配置环境变量（参考README.md）
5. 启动开发服务器：
   ```bash
   npm run dev
   ```

#### 提交代码
1. 创建新分支：
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. 进行开发并提交：
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```
3. 推送到你的fork：
   ```bash
   git push origin feature/your-feature-name
   ```
4. 创建Pull Request

## 📝 开发规范

### 代码风格
- 使用TypeScript
- 遵循ESLint和Prettier配置
- 使用有意义的变量和函数名
- 添加适当的注释

### 提交信息格式
使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

类型包括：
- `feat`: 新功能
- `fix`: 修复bug
- `docs`: 文档更新
- `style`: 代码格式化
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

### 测试
- 为新功能添加测试
- 确保所有测试通过：
  ```bash
  npm test
  ```
- 检查代码覆盖率：
  ```bash
  npm run test:ci
  ```

## 🔍 代码审查

所有的Pull Request都需要经过代码审查：

- 确保代码质量和一致性
- 验证功能是否按预期工作
- 检查是否有潜在的安全问题
- 确保文档是最新的

## 📚 开发资源

### 项目架构
- **前端**: Next.js 14 + React 18 + TypeScript
- **样式**: Styled JSX + CSS Modules
- **认证**: GitHub OAuth 2.0
- **API**: GitHub REST API

### 有用的链接
- [Next.js文档](https://nextjs.org/docs)
- [React文档](https://reactjs.org/docs)
- [GitHub API文档](https://docs.github.com/en/rest)
- [TypeScript文档](https://www.typescriptlang.org/docs)

## 🎯 开发优先级

当前需要帮助的领域：

1. **功能增强**
   - 图片编辑功能
   - 批量操作优化
   - 搜索和过滤

2. **性能优化**
   - 图片懒加载
   - 缓存策略
   - 打包优化

3. **用户体验**
   - 移动端优化
   - 无障碍访问
   - 国际化

4. **测试覆盖**
   - 单元测试
   - 集成测试
   - E2E测试

## 🆘 获取帮助

如果你在贡献过程中遇到问题：

- 查看现有的 [Issues](https://github.com/lfkdsk/PictorG/issues)
- 在 [Discussions](https://github.com/lfkdsk/PictorG/discussions) 中提问
- 联系维护者

## 🏆 贡献者

感谢所有为PicG项目做出贡献的开发者！

<!-- 这里会自动生成贡献者列表 -->

---

再次感谢你的贡献！每一个贡献都让PicG变得更好。