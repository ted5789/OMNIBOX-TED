// @name 影视库
// @author lampon
// @description 
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/影视库/影视库.js


/**
 * 影视库（网盘入库版）完整爬虫脚本
 *
 * 与 scheduled_task_drive_batch_to_library.js / 手工 upsert 写入的数据配合：
 * - playbackPayload.kind === "cloud_share"
 * - playbackPayload.category / movieName（入库脚本按「分类/影片文件夹」写入）
 * - genres[0] 一般为分类名，可与后端 /media/list 的 genre 参数联动筛选
 * - episodes[].playId 格式：分享链接|文件ID（与 pansou.js 一致，便于走 getDriveVideoPlayInfo）
 *
 * 功能对齐参考：backend/static/templates/js/pansou.js
 * - home：影视库推荐 + 可选「最近观看 / 收藏」（需爬虫源 context.sourceId）
 * - category / search：分页读 listMediaItems
 * - detail：展开为 vod_play_sources（多线路：服务端代理 / 本地代理 / 直连，夸克/UC 与 pansou 类似）
 * - play：解析 playId，调用 getDriveVideoPlayInfo，可选写观看记录、弹幕
 *
 * 环境变量：
 *   OMNIBOX_API_URL=http://127.0.0.1:端口/api/spider/omnibox
 */

const OmniBox = require("omnibox_sdk");

/**
 * 外部 CMS 资源站点列表（来自 sites_export_2026-01-16.json，已去重）
 * type_id 格式：ext_<key>
 */
const EXTERNAL_SITES = [
  { key: "baofeng",     name: "baofeng",      api: "http://by.bfzyapi.com/api.php/provide/vod" },
  { key: "最大资源",    name: "最大资源",      api: "https://api.zuidapi.com/api.php/provide/vod/" },
  { key: "bfzy",        name: "暴风资源",      api: "https://bfzyapi.com/api.php/provide/vod" },
  { key: "无尽资源",    name: "无尽资源",      api: "https://api.wujinapi.me/api.php/provide/vod/" },
  { key: "dyttzy",      name: "电影天堂资源",  api: "http://caiji.dyttzyapi.com/api.php/provide/vod" },
  { key: "maotaizy",    name: "茅台资源",      api: "https://caiji.maotaizy.cc/api.php/provide/vod" },
  { key: "ffzy",        name: "非凡影视",      api: "http://ffzy5.tv/api.php/provide/vod" },
  { key: "zy360",       name: "360资源",       api: "https://360zy.com/api.php/provide/vod" },
  { key: "dbzy",        name: "豆瓣资源",      api: "https://dbzy.tv/api.php/provide/vod" },
  { key: "yinghua",     name: "樱花资源",      api: "https://m3u8.apiyhzy.com/api.php/provide/vod" },
  { key: "wolong",      name: "卧龙资源",      api: "https://wolongzyw.com/api.php/provide/vod" },
  { key: "lzi",         name: "量子资源站",    api: "https://cj.lziapi.com/api.php/provide/vod" },
  { key: "wwzy",        name: "旺旺短剧",      api: "https://wwzy.tv/api.php/provide/vod" },
  { key: "1080资源库",  name: "1080资源库",    api: "https://api.1080zyku.com/inc/api_mac10.php/" },
  { key: "豪华资源",    name: "豪华资源",      api: "https://hhzyapi.com/api.php/provide/vod/" },
  { key: "jianpian",    name: "jianpian",      api: "http://zhangqun1818.serv00.net/jianpian1.php" },
  { key: "ruyi",        name: "如意资源",      api: "http://cj.rycjapi.com/api.php/provide/vod" },
  { key: "ikun",        name: "iKun资源",      api: "https://ikunzyapi.com/api.php/provide/vod" },
  { key: "极速资源",    name: "极速资源",      api: "https://jszyapi.com/api.php/provide/vod/" },
  { key: "电影天堂资源",name: "电影天堂资源",  api: "https://caiji.dyttzyapi.com/api.php/provide/vod/" },
  { key: "魔都资源",    name: "魔都资源",      api: "https://www.mdzyapi.com/api.php/provide/vod/" },
  { key: "百度云资源",  name: "百度云资源",    api: "https://api.apibdzy.com/api.php/provide/vod/" },
  { key: "步步高资源",  name: "步步高资源",    api: "https://api.yparse.com/api/json" },
  { key: "红牛资源",    name: "红牛资源",      api: "https://www.hongniuzy2.com/api.php/provide/vod/" },
  { key: "卧龙资源2",   name: "卧龙资源2",     api: "https://collect.wolongzyw.com/api.php/provide/vod/" },
  { key: "速播资源",    name: "速播资源",      api: "https://subocaiji.com/api.php/provide/vod/" },
  { key: "快车资源",    name: "快车资源",      api: "https://caiji.kuaichezy.org/api.php/provide/vod/" },
  { key: "CK资源",      name: "CK资源",        api: "https://ckzy.me/api.php/provide/vod/" },
  { key: "新浪点播",    name: "新浪点播",      api: "https://api.xinlangapi.com/xinlangapi.php/provide/vod/" },
  { key: "U酷资源",     name: "U酷资源",       api: "https://api.ukuapi.com/api.php/provide/vod/" },
  { key: "maoyao",      name: "maoyao",        api: "https://api.maoyanapi.top/api.php/provide/vod" },
  { key: "360",         name: "360",           api: "https://360zyzz.com/api.php/provide/vod" },
];

/** 根据 type_id（ext_<key>）找到对应站点 */
function findExternalSite(tid) {
  if (!tid || !tid.startsWith("ext_")) return null;
  const key = tid.slice(4);
  return EXTERNAL_SITES.find((s) => s.key === key) || null;
}

/** 将分类名编码为 category 接口的 type_id（首页动态「分类」Tab） */
function genreToTypeId(g) {
  if (!g) return "";
  return (
    "g64_" +
    Buffer.from(String(g), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
}

function typeIdToGenre(tid) {
  if (!tid || typeof tid !== "string") return null;
  if (!tid.startsWith("g64_")) return null;
  let b64 = tid.slice(4).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch (_) {
    return null;
  }
}

function toVodLite(item) {
  if (!item) return null;
  const cat = Array.isArray(item.genres) && item.genres.length ? item.genres[0] : "";
  const remarks = [cat, item.year, item.sourceType].filter(Boolean).join(" · ");
  return {
    vod_id: item.id,
    vod_name: item.title,
    vod_pic: item.coverUrl || "",
    vod_remarks: remarks || "",
    type_name: cat || "影视库",
  };
}

function parsePlaybackRaw(item) {
  if (!item || item.playbackPayload == null) return null;
  const raw = item.playbackPayload;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function resolveShareURL(payload, item) {
  if (payload && payload.shareURL) return String(payload.shareURL);
  if (!item || item.extra == null) return "";
  try {
    const ex = typeof item.extra === "string" ? JSON.parse(item.extra) : item.extra;
    if (ex && ex.shareURL) return String(ex.shareURL);
  } catch (_) {
    /* ignore */
  }
  return "";
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) {
  if (!scrapeData) return String(fallbackVodName || fallbackEpisodeName || "");
  const title = scrapeData.title || fallbackVodName || "";
  if (!title) return "";
  if (scrapeType === "movie") return String(title);
  const seasonAirYear = scrapeData.seasonAirYear || "";
  const seasonNumber = mapping?.seasonNumber || 1;
  const episodeNumber = mapping?.episodeNumber || 1;
  return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}

function applyScrapeToEpisodes(episodes, mappings) {
  const list = Array.isArray(episodes) ? episodes.map((e) => ({ ...e })) : [];
  const maps = Array.isArray(mappings) ? mappings : [];

  for (const ep of list) {
    const pid = String(ep.playId || "");
    if (!pid) continue;
    const m = maps.find((x) => String(x?.fileId || "") === pid);
    if (!m) continue;
    if (m.episodeName) {
      const prefix = m.episodeNumber != null ? `${m.episodeNumber}.` : "";
      ep.name = `${prefix}${m.episodeName}`.trim() || ep.name;
      ep.episodeName = m.episodeName;
    }
    if (m.episodeOverview) ep.episodeOverview = m.episodeOverview;
    if (m.episodeAirDate) ep.episodeAirDate = m.episodeAirDate;
    if (m.episodeStillPath) ep.episodeStillPath = m.episodeStillPath;
    if (m.episodeVoteAverage != null) ep.episodeVoteAverage = m.episodeVoteAverage;
    if (m.episodeRuntime != null) ep.episodeRuntime = m.episodeRuntime;
    if (m.seasonNumber != null) ep._seasonNumber = m.seasonNumber;
    if (m.episodeNumber != null) ep._episodeNumber = m.episodeNumber;
  }

  const hasEpNum = list.some((e) => e._episodeNumber != null || e._seasonNumber != null);
  if (hasEpNum) {
    list.sort((a, b) => {
      const sa = a._seasonNumber != null ? a._seasonNumber : 0;
      const sb = b._seasonNumber != null ? b._seasonNumber : 0;
      if (sa !== sb) return sa - sb;
      const ea = a._episodeNumber != null ? a._episodeNumber : 0;
      const eb = b._episodeNumber != null ? b._episodeNumber : 0;
      return ea - eb;
    });
  } else {
    list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
  }

  return list;
}

function episodesToScrapeFiles(episodes) {
  const out = [];
  for (const ep of episodes || []) {
    const playId = String(ep.playId || "");
    const name = String(ep.name || "视频");
    if (!playId) continue;
    out.push({
      fid: playId,
      file_id: playId,
      file_name: name,
      name,
      format_type: "video",
    });
  }
  return out;
}

/**
 * 首页
 */
async function home(params, context) {
  await OmniBox.log("info", "[media_library_cloud] home");
  // 首页分类不再依赖 SDK 动态返回数据，改为脚本内固定配置（参考 douban.js 的写法）。
  // 约定：入库脚本会把“分类”写入 media_item.genres[0]，这里用 genreToTypeId/ typeIdToGenre 做联动筛选。
  const fixedGenreTabs = [
    { type_id: genreToTypeId("电影"), type_name: "电影" },
    { type_id: genreToTypeId("剧集"), type_name: "剧集" },
    { type_id: genreToTypeId("综艺"), type_name: "综艺" },
    { type_id: genreToTypeId("动漫"), type_name: "动漫" },
    { type_id: genreToTypeId("纪录片"), type_name: "纪录片" },
  ];

  const externalSiteTabs = EXTERNAL_SITES.map((s) => ({
    type_id: `ext_${s.key}`,
    type_name: s.name,
  }));

  const classes = [
    { type_id: "all", type_name: "影视库全部" },
    ...fixedGenreTabs,
    { type_id: "site", type_name: "站点" },
    { type_id: "webdav", type_name: "WebDAV" },
    ...externalSiteTabs,
  ];

  let list = [];
  try {
    const page = await OmniBox.listMediaItems({ page: 1, pageSize: 12, keyword: "", sourceType: "cloud_share" });
    list = (page.list || []).map(toVodLite).filter(Boolean);
  } catch (e) {
    await OmniBox.log("warn", `[media_library_cloud] listMediaItems: ${e.message}`);
  }

  return { class: classes, list };
}

/**
 * 分类
 */
async function category(params, context) {
  const tid = params.categoryId || params.type_id || "all";
  const pg = params.page != null ? Number(params.page) : 1;
  const page = pg > 0 ? pg : 1;

  if (tid === "history" || tid === "favorite") {
    try {
      const data = await OmniBox.getSourceCategoryData(tid, page, 20);
      const list = (data.list || []).map((item) => ({
        vod_id: item.vod_id || item.VodID,
        vod_name: item.vod_name || item.VodName,
        vod_pic: item.vod_pic || item.VodPic,
        vod_remarks: item.vod_remarks || item.VodRemarks || "",
        type_name: item.type_name || item.TypeName || "",
      }));
      return {
        page,
        pagecount: data.pageCount || 1,
        limit: 20,
        total: data.total || list.length,
        list,
      };
    } catch (e) {
      await OmniBox.log("warn", `[media_library_cloud] category sdk: ${e.message}`);
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }
  }

  // 外部 CMS 资源站点（ext_<key>）
  const extSite = findExternalSite(String(tid));
  if (extSite) {
    try {
      const url = `${extSite.api.replace(/\/$/, "")}?ac=videolist&pg=${page}`;
      const resp = await OmniBox.httpGet(url, { "User-Agent": "OmniBox/1.0" });
      const json = typeof resp === "string" ? JSON.parse(resp) : resp;
      const rawList = Array.isArray(json.list) ? json.list : [];
      const list = rawList.map((v) => ({
        vod_id: `ext_${extSite.key}_${v.vod_id}`,
        vod_name: v.vod_name || "",
        vod_pic: v.vod_pic || "",
        vod_remarks: v.vod_remarks || v.vod_year || "",
        type_name: v.type_name || extSite.name,
      }));
      const total = json.total || list.length;
      const pagecount = json.pagecount || Math.max(1, Math.ceil(total / 20));
      return { page, pagecount, limit: 20, total, list };
    } catch (e) {
      await OmniBox.log("warn", `[media_library_cloud] ext site ${extSite.key}: ${e.message}`);
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }
  }

  const genreFilter = typeIdToGenre(String(tid));
  if (genreFilter) {
    const res = await OmniBox.listMediaItems({
      page,
      pageSize: 20,
      keyword: "",
      sourceType: "cloud_share",
      genre: genreFilter,
    });
    const list = (res.list || []).map(toVodLite).filter(Boolean);
    const total = res.total || 0;
    const pageSize = res.pageSize || 20;
    const pagecount = Math.max(1, Math.ceil(total / pageSize));
    return { page, pagecount, limit: pageSize, total, list };
  }

  const sourceType = tid === "all" ? "" : String(tid);
  const res = await OmniBox.listMediaItems({
    page,
    pageSize: 20,
    keyword: "",
    sourceType,
  });
  const list = (res.list || []).map(toVodLite).filter(Boolean);
  const total = res.total || 0;
  const pageSize = res.pageSize || 20;
  const pagecount = Math.max(1, Math.ceil(total / pageSize));
  return { page, pagecount, limit: pageSize, total, list };
}

/**
 * 搜索
 */
async function search(params, context) {
  const keyword = params.keyword || params.wd || "";
  const pg = params.page != null ? Number(params.page) : 1;
  const page = pg > 0 ? pg : 1;

  // 如果指定了外部站点（ext_<key>）则只搜该站
  const extSite = findExternalSite(String(params.categoryId || params.type_id || ""));
  if (extSite && keyword) {
    try {
      const url = `${extSite.api.replace(/\/$/, "")}?ac=videolist&wd=${encodeURIComponent(keyword)}&pg=${page}`;
      const resp = await OmniBox.httpGet(url, { "User-Agent": "OmniBox/1.0" });
      const json = typeof resp === "string" ? JSON.parse(resp) : resp;
      const rawList = Array.isArray(json.list) ? json.list : [];
      const list = rawList.map((v) => ({
        vod_id: `ext_${extSite.key}_${v.vod_id}`,
        vod_name: v.vod_name || "",
        vod_pic: v.vod_pic || "",
        vod_remarks: v.vod_remarks || v.vod_year || "",
        type_name: v.type_name || extSite.name,
      }));
      const total = json.total || list.length;
      const pagecount = json.pagecount || Math.max(1, Math.ceil(total / 20));
      return { page, pagecount, limit: 20, total, list };
    } catch (e) {
      await OmniBox.log("warn", `[media_library_cloud] ext search ${extSite.key}: ${e.message}`);
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }
  }

  const res = await OmniBox.listMediaItems({
    page,
    pageSize: 20,
    keyword: String(keyword),
    sourceType: "",
  });
  const list = (res.list || []).map(toVodLite).filter(Boolean);
  const total = res.total || 0;
  const pageSize = res.pageSize || 20;
  const pagecount = Math.max(1, Math.ceil(total / pageSize));
  return { page, pagecount, limit: pageSize, total, list };
}

function buildEpisodeRows(episodes, shareURL) {
  const out = [];
  for (const ep of episodes || []) {
    const name = ep.name || "剧集";
    let playId = ep.playId || "";
    if (!playId && ep.fid) {
      // 兼容旧入库：如果只给 fid，则补成 fid|shareURL
      playId = `${ep.fid}|${shareURL}`;
    }
    if (!name || !playId) continue;
    out.push({ name, playId, size: ep.size });
  }
  return out;
}

function pickPlaySourceNames(driveType, context, params) {
  const fromWeb = (context && context.from === "web") || params.source === "web";
  if (driveType === "quark" || driveType === "uc") {
    const base = ["服务端代理", "本地代理", "直连"];
    return fromWeb ? base.filter((n) => n !== "本地代理") : base;
  }
  return ["播放"];
}

function payloadToPlaySources(payload, context, params) {
  if (!payload || typeof payload !== "object") return [];
  const kind = String(payload.kind || "");

  if (kind === "cloud_share") {
    const shareURL = String(payload.shareURL || "");
    const eps = buildEpisodeRows(payload.episodes || [], shareURL);
    const driveType = String(payload.driveType || "");
    const sourceNames = pickPlaySourceNames(driveType, context, params);
    return sourceNames.map((name) => ({ name, episodes: eps.map((e) => ({ ...e })) }));
  }

  if (kind === "webdav" || kind === "site") {
    const eps = Array.isArray(payload.episodes) && payload.episodes.length
      ? payload.episodes.map((e) => ({ name: e.name || "播放", playId: e.playId || e.url || "", size: e.size }))
      : payload.playUrl
        ? [{ name: payload.episodeName || "正片", playId: String(payload.playUrl) }]
        : [];
    const sourceName = payload.sourceName || (kind === "webdav" ? "WebDAV" : "站点");
    return eps.length ? [{ name: sourceName, episodes: eps }] : [];
  }

  return [];
}

/**
 * 详情（网盘影视库条目 → vod_play_sources）
 */
async function detail(params, context) {
  const rawId = params.videoId || params.id;
  const ids = Array.isArray(rawId) ? rawId : rawId != null ? [rawId] : [];
  const list = [];

  for (const raw of ids) {
    const strId = String(raw);

    // 外部 CMS 站点条目：格式 ext_<key>_<vod_id>
    if (strId.startsWith("ext_")) {
      const withoutPrefix = strId.slice(4); // "<key>_<vod_id>"
      const firstUnderscore = withoutPrefix.indexOf("_");
      if (firstUnderscore < 0) continue;
      const siteKey = withoutPrefix.slice(0, firstUnderscore);
      const vodId = withoutPrefix.slice(firstUnderscore + 1);
      const extSite = EXTERNAL_SITES.find((s) => s.key === siteKey);
      if (!extSite || !vodId) continue;
      try {
        const url = `${extSite.api.replace(/\/$/, "")}?ac=videolist&ids=${vodId}`;
        const resp = await OmniBox.httpGet(url, { "User-Agent": "OmniBox/1.0" });
        const json = typeof resp === "string" ? JSON.parse(resp) : resp;
        const v = Array.isArray(json.list) && json.list[0] ? json.list[0] : null;
        if (!v) continue;
        const playUrls = String(v.vod_play_url || "");
        const playFrom = String(v.vod_play_from || extSite.name);
        // vod_play_from 可能是"$$$"分隔的多线路，拆分后对应 vod_play_url 的各段
        const fromParts = playFrom.split("$$$");
        const urlParts = playUrls.split("$$$");
        const playSources = fromParts.map((fromName, idx) => {
          const segRaw = urlParts[idx] || "";
          const episodes = segRaw.split("#").map((ep) => {
            const dollar = ep.indexOf("$");
            if (dollar < 0) return null;
            return { name: ep.slice(0, dollar), playId: ep.slice(dollar + 1) };
          }).filter(Boolean);
          return { name: fromName || extSite.name, episodes };
        }).filter((ps) => ps.episodes.length);
        list.push({
          vod_id: strId,
          vod_name: v.vod_name || "",
          vod_pic: v.vod_pic || "",
          type_name: v.type_name || extSite.name,
          vod_year: v.vod_year || "",
          vod_area: v.vod_area || "",
          vod_remarks: v.vod_remarks || "",
          vod_actor: v.vod_actor || "",
          vod_director: v.vod_director || "",
          vod_content: v.vod_blurb || v.vod_content || "",
          vod_play_sources: playSources,
        });
      } catch (e) {
        await OmniBox.log("warn", `[media_library_cloud] ext detail ${siteKey}: ${e.message}`);
      }
      continue;
    }

    const item = await OmniBox.getMediaItem(strId);
    if (!item) continue;

    const payload = parsePlaybackRaw(item);
    const kind = payload && payload.kind ? String(payload.kind) : "";
    const share = resolveShareURL(payload, item);

    let resolvedDrive = kind === "cloud_share" ? String(payload.driveType || "") : "";
    if (kind === "cloud_share" && !resolvedDrive && share) {
      try {
        const di = await OmniBox.getDriveInfoByShareURL(share);
        resolvedDrive = di.driveType || "";
      } catch (_) {
        /* ignore */
      }
    }

    let playSources = payloadToPlaySources(
      kind === "cloud_share" ? { ...payload, driveType: resolvedDrive, shareURL: share || payload.shareURL } : payload,
      context,
      params,
    );

    // 刮削：对 cloud_share/webdav/site 统一按“影视库条目ID”做资源ID，避免 shareURL/路径变化导致不稳定
    try {
      if (context && context.sourceId && playSources.length) {
        const episodesAll = [];
        for (const ps of playSources) {
          for (const ep of ps.episodes || []) episodesAll.push(ep);
        }
        const files = episodesToScrapeFiles(episodesAll);
        if (files.length) {
          await OmniBox.processScraping(String(item.id), String(item.title || ""), String(item.originalTitle || item.title || ""), files);
          const meta = await OmniBox.getScrapeMetadata(String(item.id));
          const scrapeData = meta && meta.scrapeData ? meta.scrapeData : null;
          const mappings = Array.isArray(meta && meta.videoMappings) ? meta.videoMappings : [];
          if (mappings.length) {
            playSources = playSources.map((ps) => ({
              ...ps,
              episodes: applyScrapeToEpisodes(ps.episodes || [], mappings),
            }));
          }
          if (scrapeData && scrapeData.title) {
            item.title = scrapeData.title;
          }
          if (scrapeData && scrapeData.posterPath) {
            item.coverUrl = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
          }
          if (scrapeData && scrapeData.releaseDate) {
            item.year = String(scrapeData.releaseDate).substring(0, 4);
          }
          if (scrapeData && scrapeData.overview) {
            item.description = String(scrapeData.overview);
          }
          if (scrapeData && scrapeData.credits) {
            const cast = Array.isArray(scrapeData.credits.cast) ? scrapeData.credits.cast : [];
            const crew = Array.isArray(scrapeData.credits.crew) ? scrapeData.credits.crew : [];
            item.actors = cast.slice(0, 6).map((c) => c?.name).filter(Boolean);
            item.directors = crew
              .filter((c) => c?.job === "Director" || c?.department === "Directing")
              .slice(0, 3)
              .map((c) => c?.name)
              .filter(Boolean);
          }
        }
      }
    } catch (e) {
      await OmniBox.log("warn", `[media_library_cloud] scraping: ${e.message}`);
    }

    const cat = (payload && payload.category) || (Array.isArray(item.genres) && item.genres[0]) || "";
    const mName = (payload && payload.movieName) || item.originalTitle || "";
    const remarks = [cat, mName, resolvedDrive || kind || item.sourceType].filter(Boolean).join(" · ");

    if (playSources.length) {
      // 将媒体库 ID 拼到 playId 末尾，play 接口可直接通过 playId 获取更多信息
      playSources = playSources.map((ps) => ({
        ...ps,
        episodes: (ps.episodes || []).map((ep) => ({
          ...ep,
          playId: ep && ep.playId ? `${ep.playId}|${item.id}` : ep.playId,
        })),
      }));
      list.push({
        vod_id: item.id,
        vod_name: item.title,
        vod_pic: item.coverUrl || "",
        type_name: cat ? `影视库 · ${cat}` : "影视库",
        vod_year: item.year || "",
        vod_area: cat || item.region || "",
        vod_remarks: remarks || "影视库",
        vod_actor: Array.isArray(item.actors) ? item.actors.join(",") : "",
        vod_director: Array.isArray(item.directors) ? item.directors.join(",") : "",
        vod_content: item.description || "",
        vod_play_sources: playSources,
      });
      continue;
    }

    // 兜底：旧结构 url/urls
    const p = payload || {};
    let urls = [];
    if (p.urls && Array.isArray(p.urls)) urls = p.urls;
    else if (p.url) urls = [{ name: "播放", url: p.url }];
    const vodPlayUrl = urls.map((u) => `${u.name}$${u.url}`).join("#");
    list.push({
      vod_id: item.id,
      vod_name: item.title,
      vod_pic: item.coverUrl || "",
      type_name: "影视库",
      vod_year: item.year || "",
      vod_content: item.description || "",
      vod_play_from: "影视库",
      vod_play_url: vodPlayUrl || "",
    });
  }

  return { list };
}

/**
 * 播放
 * playId 格式：文件ID|媒体表Id
 */
async function play(params, context) {
    const flag = params.flag || "服务端代理";

    // 外部 CMS 站点直链播放（playId 就是直链 URL）
    if (params.playId && !params.playId.includes("|") && (params.playId.startsWith("http://") || params.playId.startsWith("https://"))) {
        return { urls: [{ name: "播放", url: params.playId }], flag: params.flag || "站点", header: {}, parse: 1, danmaku: [] };
    }

    const parts = params.playId.split("|");
    const libraryVodId = parts[1];
    const fileId = parts[0];
    let item = null;
    let payload = null;
    try {
        if (libraryVodId) {
            item = await OmniBox.getMediaItem(libraryVodId);
            payload = parsePlaybackRaw(item);
        }
    } catch (_) {
        item = null;
        payload = null;
    }

    const kind = payload && payload.kind ? String(payload.kind) : "";

    // webdav/site：playId 直接是 URL，header 可能来自 payload.header
    if (kind === "webdav" || kind === "site") {
        const urlOnly =fileId;
        const header = (payload && payload.header && typeof payload.header === "object") ? payload.header : {};
        let danmaku = [];
        try {
            const meta = libraryVodId ? await OmniBox.getScrapeMetadata(libraryVodId) : null;
            const scrapeData = meta && meta.scrapeData ? meta.scrapeData : null;
            const mappings = Array.isArray(meta && meta.videoMappings) ? meta.videoMappings : [];
            const mapping = mappings.find((m) => String(m?.fileId || "") === urlOnly);
            const fileName = buildScrapedDanmuFileName(scrapeData, meta?.scrapeType || "", mapping, item?.title || params.title || "", params.episodeName || "");
            if (fileName) {
                danmaku = await OmniBox.getDanmakuByFileName(fileName);
            }
        } catch (_) {
            /* ignore */
        }

        try {
            if (context && context.sourceId && libraryVodId) {
                let totalDuration = null;
                try {
                    const info = await OmniBox.getVideoMediaInfo(urlOnly, header);
                    const dur = info && info.format && info.format.duration;
                    if (typeof dur === "number" && Number.isFinite(dur) && dur > 0) totalDuration = dur;
                } catch (_) {
                    /* ignore */
                }
                await OmniBox.addPlayHistory({
                    vodId: libraryVodId,
                    title: (item && item.title) || params.title || urlOnly,
                    pic: (item && item.coverUrl) || params.pic || "",
                    episode: urlOnly,
                    episodeName: params.episodeName || "",
                    totalDuration: totalDuration != null ? totalDuration : undefined,
                });
            }
        } catch (e) {
            await OmniBox.log("warn", `[media_library_cloud] addPlayHistory: ${e.message}`);
        }

        return { urls: [{ name: "播放", url: urlOnly }], flag: kind, header, parse: 0, danmaku: Array.isArray(danmaku) ? danmaku : [] };
    }
    else {

            const fid = fileId;
            const shareURL = item.from;
            if (!shareURL || !fid) return { urls: [], flag: "", header: {}, parse: 0, danmaku: [] };

            try {
                const getTc = params.getTranscodeUrls !== false;
                const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, fid, flag, getTc);
                const urlList = playInfo && Array.isArray(playInfo.url) ? playInfo.url : [];
                const urlsResult = urlList.map((x) => ({ name: x.name || "播放", url: x.url })).filter((x) => x.url);
                if (!urlsResult.length) throw new Error("无法获取播放地址");

                const header = playInfo.header || {};

                // 优先用刮削元数据生成弹幕名（如 S01E01）
                let danmakuList = Array.isArray(playInfo.danmaku) ? playInfo.danmaku : [];
                try {
                    if (libraryVodId) {
                        const meta = await OmniBox.getScrapeMetadata(libraryVodId);
                        const scrapeData = meta && meta.scrapeData ? meta.scrapeData : null;
                        const mappings = Array.isArray(meta && meta.videoMappings) ? meta.videoMappings : [];
                        const playIdNoLib = libraryVodId ? `${fid}|${shareURL}` : playId;
                        const mapping = mappings.find((m) => String(m?.fileId || "") === playIdNoLib);
                        const fileName = buildScrapedDanmuFileName(scrapeData, meta?.scrapeType || "", mapping, (item && item.title) || params.title || "", params.episodeName || "");
                        if (fileName) {
                            const dm = await OmniBox.getDanmakuByFileName(fileName);
                            if (Array.isArray(dm) && dm.length) danmakuList = dm;
                        }
                    }
                } catch (_) {
                    /* ignore */
                }

                try {
                    if (context && context.sourceId && libraryVodId) {
                        let totalDuration = null;
                        try {
                            const info = await OmniBox.getVideoMediaInfo(urlsResult[0].url, header);
                            const dur = info && info.format && info.format.duration;
                            if (typeof dur === "number" && Number.isFinite(dur) && dur > 0) totalDuration = dur;
                        } catch (_) {
                            /* ignore */
                        }
                        await OmniBox.addPlayHistory({
                            vodId: libraryVodId,
                            title: (item && item.title) || params.title || shareURL,
                            pic: (item && item.coverUrl) || params.pic || "",
                            episode: `${fid}|${shareURL}`,
                            episodeName: params.episodeName || "",
                            totalDuration: totalDuration != null ? totalDuration : undefined,
                        });
                    }
                } catch (e) {
                    await OmniBox.log("warn", `[media_library_cloud] addPlayHistory: ${e.message}`);
                }

                return { urls: urlsResult, flag: shareURL, header, parse: 0, danmaku: danmakuList };
            } catch (e) {
                await OmniBox.log("error", `[media_library_cloud] play: ${e.message}`);
                return { urls: [], flag: "", header: {}, parse: 0, danmaku: [] };
            }

    }
}

module.exports = {
  home,
  category,
  search,
  detail,
  play,
};

const runner = require("spider_runner");
runner.run(module.exports);
