# 去走走 Walkies 🚶

一个手机优先的城市行走记录 Web 应用（项目文件夹沿用 `citywalk/`）：记录每次行走的 GPS 轨迹，在地图上汇总所有路线；按网格统计你的「城市探索度」；上传照片自动读取拍摄位置并标注到地图上。所有数据只存在本地浏览器里，不上传任何服务器。

## 功能

- **记录路线**：GPS 实时轨迹、距离、时长；支持暂停/继续；意外关闭页面后可自动恢复未完成的路线；录制时自动申请屏幕常亮。
- **地图汇总**：所有路线按颜色区分叠在一张地图上，点击查看详情；路线可重命名、删除、导出 GPX。
- **探索网格**：把走过的区域切成格子高亮显示，一眼看出「哪些区域去过了、哪些还没打卡」，并统计已探索面积。
- **照片墙**：批量添加照片，自动解析 EXIF 中的 GPS 拍摄位置和拍摄时间，以圆形图钉标到地图上；没有位置信息的照片可以手动在地图上点选标注。
- **数据自主**：一键导出/导入 JSON 备份（含照片），支持导入其他 App 导出的 GPX 路线。
- **双底图**：高德地图（GCJ-02 偏移已自动处理）/ OpenStreetMap 一键切换。

## 运行

```bash
cd citywalk
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

直接双击 index.html 也能打开，但部分浏览器会限制本地文件的定位与存储，建议用上面的方式起一个本地服务。

## 在手机上使用

浏览器的定位（GPS）只在 **HTTPS 或 localhost** 下可用，所以在手机上正式使用前，把整个 `citywalk` 文件夹部署到任意静态托管即可：

- GitHub Pages / Vercel / Netlify / Cloudflare Pages：直接上传即可，零配置。
- 部署后用手机浏览器打开，选择「添加到主屏幕」，即可像 App 一样全屏使用。

局域网临时测试（`http://192.168.x.x:8080`）时定位会被浏览器禁用；Android Chrome 可在 `chrome://flags/#unsafely-treat-insecure-origin-as-secure` 中把该地址加入白名单解决。

## 注意事项

- **照片位置**：需要拍照时相机 App 有位置权限。微信/QQ 聊天发送的照片会被压缩并抹掉 GPS，请使用「原图」、隔空投送（AirDrop）或数据线导出照片。
- **坐标系**：内部统一用 WGS-84（GPS 原始坐标）存储，高德底图显示时自动转 GCJ-02，导出的 GPX 也是标准 WGS-84，可导入任何其他平台。
- **数据存储**：全部在本机浏览器 IndexedDB 中，清除浏览器数据会一并删除，请定期用「设置 → 导出全部数据」备份。

## 技术说明

无构建步骤、无框架，纯原生 JavaScript + [Leaflet](https://leafletjs.com)（地图）+ [exifr](https://github.com/MikeKovarik/exifr)（EXIF 解析），两个依赖都已放在 `vendor/` 目录本地化，无需外网 CDN。```
citywalk/
├── index.html        页面骨架
├── css/style.css     样式
├── js/
│   ├── geo.js        距离计算、WGS-84↔GCJ-02 转换、瓦片网格
│   ├── util.js       弹窗 / Toast / 下载 / 日期工具
│   ├── db.js         IndexedDB 封装
│   ├── coverage.js   探索网格统计
│   ├── tracker.js    轨迹记录状态机（含崩溃恢复、屏幕常亮）
│   ├── photos.js     照片 EXIF 解析、缩略图
│   ├── mapView.js    地图与图层渲染
│   └── main.js       页面逻辑、导入导出
└── vendor/           Leaflet + exifr（本地化依赖）
```
