module.exports = {
  root: true,
  extends: [
    "next/core-web-vitals"
  ],
  rules: {
    // 自定义规则
    "@next/next/no-img-element": "off",
    "react/no-unescaped-entities": "off"
  }
}
