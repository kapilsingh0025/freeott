import bcrypt from "bcryptjs";
import { lookup } from "node:dns/promises";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { isIP } from "node:net";
import type { ObjectId } from "mongodb";
import { getCollections } from "../database/index.js";

interface ApiRequest {
  url: string;
  method: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

interface User {
  _id: number | ObjectId;
  name: string;
  email: string;
  hash: string;
  role: string;
  watchlist: string[];
  theme: string;
  fails: number;
  lockUntil: Date | null;
  createdAt: Date;
}
interface Movie {
  _id?: string;
  id: string;
  kind: string;
  url: string;
  title: string;
  genre: string;
  year: number;
  minutes: number;
  description: string;
  lang: string;
  age: string;
  director: string;
  cast: string;
  poster: string;
  thumb?: string;
  hue: number;
  featured: boolean;
  createdAt: Date;
}

const SEED = [
  {id:"YE7VzlLtp-4",title:"Big Buck Bunny",year:2008,minutes:10,genre:"Animation",hue:150,featured:true,description:"A big, gentle rabbit takes revenge on three mischievous rodents."},
  {id:"eRsGyueVLvQ",title:"Sintel",year:2010,minutes:15,genre:"Animation",hue:350,description:"A young woman sets out to find the dragon friend she lost."},
  {id:"R6MlUcmOul8",title:"Tears of Steel",year:2012,minutes:12,genre:"Sci-Fi",hue:200,description:"A sci-fi story of fighting off robots in a future Amsterdam."},
  {id:"TLkA0RELQ1g",title:"Elephants Dream",year:2006,minutes:11,genre:"Sci-Fi",hue:260,description:"Two strange characters wander through a surreal world of machines."},
  {id:"WhWc3b3KhnY",title:"Spring",year:2019,minutes:8,genre:"Animation",hue:20,description:"A young shepherd and her dog meet the spirits of spring."},
  {id:"Y-rmzh0PI3c",title:"Cosmos Laundromat",year:2015,minutes:12,genre:"Comedy",hue:280,description:"A lonely man is offered new lives by an odd salesman."},
  {id:"mN0zPOpADL4",title:"Agent 327",year:2017,minutes:4,genre:"Comedy",hue:30,description:"A bumbling spy investigates a mysterious new shop."},
  {id:"PVGeM40dABA",title:"Coffee Run",year:2020,minutes:3,genre:"Comedy",hue:20,description:"A small mistake at a coffee shop takes a big turn."},
  {id:"_cMxraX_5RE",title:"Sprite Fright",year:2021,minutes:10,genre:"Comedy",hue:295,description:"Friends on a woodland picnic run into mischievous sprites."},
  {id:"SkVqJ1SGeL0",title:"Caminandes: Llamigos",year:2016,minutes:3,genre:"Animation",hue:100,description:"A funny friendship between a llama and a penguin."}
];

const out = (code: number, obj: unknown, cookie?: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(obj), { status: code, headers });
};
const mkCookie = (t: string, secure: boolean) => `jt=${t}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Path=/; Max-Age=${7 * 86400}`;
const clearCookie = (secure: boolean) => `jt=; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Path=/; Max-Age=0`;
const pub = (u: User) => ({ name: u.name, email: u.email, role: u.role, watchlist: u.watchlist || [], theme: u.theme || "" });
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const adminEmail = () => (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = () => process.env.ADMIN_PASSWORD || "";
const parseSrc = (v: unknown) => {
  const s = str(v, 500);
  const y = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  if (y) return { kind: "yt", id: y[1], url: "" };
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return null;
  if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) return { kind: "file", id: "", url: parsed.href };
  return { kind: "web", id: "", url: parsed.href };
};
function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return (first & 0xe000) === 0x2000 &&
      !/^2001:(?:0|10|db8):/.test(normalized) &&
      !normalized.startsWith("2002:");
  }
  return false;
}
async function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) return false;
    if (isIP(url.hostname)) return isPublicAddress(url.hostname);
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address));
  } catch {
    return false;
  }
}
function metaContent(tag: string, key: string) {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  const property = (attributes.get("property") || attributes.get("name") || "").toLowerCase();
  return property === key ? attributes.get("content") || "" : "";
}
async function pagePoster(url: string) {
  const source = new URL(url);
  if (/\.(avif|gif|jpe?g|png|webp)$/i.test(source.pathname)) return source.href;
  if (!await isPublicHttpsUrl(url)) return "";
  const fallback = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(source.hostname)}&sz=256`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "just99-link-preview/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html") || !response.body) return fallback;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        return fallback;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const html = new TextDecoder().decode(bytes);
    const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) || [];
    for (const key of ["og:image", "og:image:secure_url", "twitter:image"]) {
      for (const tag of tags) {
        const candidate = metaContent(tag, key);
        if (!candidate) continue;
        const image = new URL(candidate.replace(/&amp;/gi, "&"), url);
        if (await isPublicHttpsUrl(image.href)) return image.href;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}
const toClient = (m: Movie) => ({
  id: m.id, kind: m.kind, url: m.url, t: m.title, g: m.genre, y: m.year, m: m.minutes, d: m.description,
  lang: m.lang, age: m.age, dir: m.director, cast: m.cast, poster: m.poster,
  thumb: m.poster ? "" : m.kind === "yt" ? `https://i.ytimg.com/vi/${encodeURIComponent(m.id)}/hqdefault.jpg` : m.thumb || (m.url ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(m.url).hostname)}&sz=256` : ""),
  h: m.hue, f: m.featured,
});

let secret = "";
let adminBootstrapped = false;
async function getSecret(settings: any) {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (secret) return secret;
  const existing = await settings.findOne({ id: "cfg" });
  if (existing?.jwtSecret) return (secret = existing.jwtSecret);
  const generated = crypto.randomBytes(48).toString("hex");
  await settings.updateOne({ id: "cfg" }, { $setOnInsert: { id: "cfg", maxUsers: 0, jwtSecret: generated } }, { upsert: true });
  const cfg = await settings.findOne({ id: "cfg" });
  return (secret = cfg?.jwtSecret || generated);
}

async function bootstrapAdmin(users: any) {
  if (adminBootstrapped) return;
  const email = adminEmail();
  const password = adminPassword();
  if (!email || !password) return;
  const existing = await users.findOne({ email });
  if (!existing) {
    await users.insertOne({ _id: Date.now(), name: "Admin", email, hash: await bcrypt.hash(password, 12), role: "admin", watchlist: [], theme: "", fails: 0, lockUntil: null, createdAt: new Date() });
    adminBootstrapped = true;
    return;
  }
  const patch: any = { role: "admin" };
  if (!(await bcrypt.compare(password, existing.hash))) patch.hash = await bcrypt.hash(password, 12);
  await users.updateOne({ _id: existing._id }, { $set: patch });
  adminBootstrapped = true;
}

async function maxUsers(settings: any) {
  const cfg = await settings.findOne({ id: "cfg" });
  return Number(cfg?.maxUsers || 0);
}
async function userCount(users: any) { return users.countDocuments(); }
const userKey = (key: string, u: User) => key + u.hash;

async function authUser(req: ApiRequest, key: string, users: any) {
  const c = (req.headers.get("cookie") || "").match(/(?:^|;\s*)jt=([^;]+)/);
  if (!c) return null;
  try {
    const p = jwt.decode(c[1]) as { uid?: string } | null;
    if (!p?.uid) return null;
    const u = await users.findOne({ _id: Number(p.uid) }) as User | null;
    if (!u) return null;
    jwt.verify(c[1], userKey(key, u));
    return u;
  } catch { return null; }
}

export default async (req: ApiRequest) => {
  const route = new URL(req.url).pathname.replace(/^.*?\/api/, "").replace(/\/+$/, "") || "/";
  if (route === "/config" && req.method === "GET") {
    return out(200, {
      databaseConfigured: !!process.env.MONGODB_URI,
      adminConfigured: !!adminEmail() && !!adminPassword(),
    });
  }
  if (!process.env.MONGODB_URI) {
    return out(503, { error: "The app is not configured yet. Set MONGODB_URI in your environment variables." });
  }
  try {
    const { users, movies, settings } = await getCollections();
    await users.createIndex({ email: 1 }, { unique: true });
    await movies.createIndex({ id: 1 }, { unique: true });
    await bootstrapAdmin(users);
    const key = await getSecret(settings);
    const sign = (u: User) => jwt.sign({ uid: String(u._id) }, userKey(key, u), { expiresIn: "7d" });
    const secureCookie = req.headers.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
    const m = req.method;
    let body: any = {};
    if (m === "POST") {
      try { const t = await req.text(); body = t ? JSON.parse(t) : {}; } catch { return out(400, { error: "Bad request." }); }
    }

    if (route === "/signup" && m === "POST") {
      const name = str(body.name, 60), email = str(body.email, 120).toLowerCase();
      const pw = typeof body.password === "string" ? body.password : "";
      if (!name) return out(400, { error: "Enter your name." });
      if (!/^\S+@\S+\.\S+$/.test(email)) return out(400, { error: "Enter a valid email address." });
      if (pw.length < 6 || pw.length > 100) return out(400, { error: "Password must be at least 6 characters." });
      const hasAdmin = !!(await users.findOne({ role: "admin" }));
      const role = adminEmail() ? (email === adminEmail() ? "admin" : "user") : (hasAdmin ? "user" : "admin");
      const cap = await maxUsers(settings);
      if (cap > 0 && role !== "admin" && (await userCount(users)) >= cap) return out(403, { error: "Signups are closed: the user limit has been reached." });
      const u: User = { _id: Date.now(), name, email, hash: await bcrypt.hash(pw, 10), role, watchlist: [], theme: "", fails: 0, lockUntil: null, createdAt: new Date() };
      try { await users.insertOne(u); } catch { return out(409, { error: "This email is already registered. Please log in." }); }
      return out(200, { user: pub(u) }, mkCookie(sign(u), secureCookie));
    }

    if (route === "/login" && m === "POST") {
      const email = str(body.email, 120).toLowerCase();
      const pw = typeof body.password === "string" ? body.password : "";
      const u = await users.findOne({ email }) as User | null;
      if (u?.lockUntil && new Date(u.lockUntil) > new Date()) return out(429, { error: "Too many failed attempts. Try again in 15 minutes." });
      if (!u || !(await bcrypt.compare(pw, u.hash))) {
        if (u) {
          const fails = (u.fails || 0) + 1;
          await users.updateOne({ _id: u._id }, { $set: fails >= 5 ? { fails: 0, lockUntil: new Date(Date.now() + 15 * 60000) } : { fails } });
        }
        return out(401, { error: "Incorrect email or password." });
      }
      const patch: any = {};
      if (u.fails || u.lockUntil) Object.assign(patch, { fails: 0, lockUntil: null });
      if (adminEmail() && u.email === adminEmail() && u.role !== "admin") patch.role = "admin";
      if (Object.keys(patch).length) await users.updateOne({ _id: u._id }, { $set: patch });
      return out(200, { user: pub({ ...u, ...patch }) }, mkCookie(sign({ ...u, ...patch }), secureCookie));
    }

    if (route === "/logout" && m === "POST") return out(200, { ok: true }, clearCookie(secureCookie));
    const me = await authUser(req, key, users);
    if (!me) return out(401, { error: "Please log in." });

    if (route === "/theme" && m === "POST") {
      await users.updateOne({ _id: me._id }, { $set: { theme: body.theme === "dark" || body.theme === "light" ? body.theme : "" } });
      return out(200, { ok: true });
    }
    if (route === "/me" && m === "GET") return out(200, { user: pub(me) });

    if (route === "/password" && m === "POST") {
      const cur = typeof body.current === "string" ? body.current : "";
      const pw = typeof body.password === "string" ? body.password : "";
      if (!(await bcrypt.compare(cur, me.hash))) return out(400, { error: "Current password is incorrect." });
      if (pw.length < 8 || pw.length > 100) return out(400, { error: "New password must be at least 8 characters." });
      if (pw === cur) return out(400, { error: "New password must be different from the current one." });
      const hash = await bcrypt.hash(pw, 12);
      const u = { ...me, hash } as User;
      const result = await users.updateOne({ _id: me._id }, { $set: { hash } });
      if (!result.matchedCount) return out(404, { error: "Your account could not be found. Please log in again." }, clearCookie(secureCookie));
      return out(200, { ok: true }, mkCookie(sign(u), secureCookie));
    }

    if (route === "/movies" && m === "GET") {
      if ((await movies.countDocuments()) === 0) {
        const now = new Date();
        await movies.insertMany(SEED.map((x: any) => ({ ...x, kind: "yt", url: "", lang: "", age: "", director: "", cast: "", poster: "", createdAt: now })));
      }
      const list = await movies.find({}).sort({ createdAt: 1, title: 1 }).toArray() as unknown as Movie[];
      return out(200, { movies: list.map(toClient) });
    }

    if (route === "/watchlist" && m === "POST") {
      const id = str(body.id, 24);
      if (!id) return out(400, { error: "Bad request." });
      const has = (me.watchlist || []).includes(id);
      const update: any = has ? { $pull: { watchlist: id } } : { $addToSet: { watchlist: id } };
      await users.updateOne({ _id: me._id }, update);
      return out(200, { ok: true });
    }

    if (route.startsWith("/admin") && me.role !== "admin") return out(403, { error: "Admins only." });

    if (route === "/admin/users" && m === "GET") {
      const list = await users.find({}).sort({ createdAt: 1 }).toArray() as unknown as User[];
      return out(200, { maxUsers: await maxUsers(settings), users: list.map(u => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : "", watch: (u.watchlist || []).length, self: u._id === me._id })) });
    }
    const au = route.match(/^\/admin\/users\/(\d{1,20})(\/password)?$/);
    if (au && !au[2] && m === "DELETE") {
      if (Number(au[1]) === me._id) return out(400, { error: "You cannot delete your own account." });
      const result = await users.deleteOne({ _id: Number(au[1]) });
      if (!result.deletedCount) return out(404, { error: "User not found." });
      return out(200, { ok: true });
    }
    if (au && au[2] && m === "POST") {
      const pw = typeof body.password === "string" ? body.password : "";
      if (pw.length < 6 || pw.length > 100) return out(400, { error: "Password must be at least 6 characters." });
      const result = await users.updateOne({ _id: Number(au[1]) }, { $set: { hash: await bcrypt.hash(pw, 10), fails: 0, lockUntil: null } });
      if (!result.matchedCount) return out(404, { error: "User not found." });
      return out(200, { ok: true });
    }
    if (route === "/admin/settings" && m === "GET") return out(200, { maxUsers: await maxUsers(settings), count: await userCount(users) });
    if (route === "/admin/settings" && m === "POST") {
      const n = Math.max(0, Math.min(100000, Math.floor(+body.maxUsers || 0)));
      await settings.updateOne({ id: "cfg" }, { $set: { maxUsers: n } }, { upsert: true });
      return out(200, { ok: true });
    }

    if (route === "/movies" && m === "POST") {
      if (me.role !== "admin") return out(403, { error: "Admins only." });
      const src = parseSrc(body.src), t = str(body.t, 100), editId = str(body.id, 24);
      if (!src || !t) return out(400, { error: "Enter a valid http or https video/website link and a title." });
      let id = src.id;
      if (src.kind !== "yt") {
        const old = editId ? await movies.findOne({ id: editId, kind: src.kind }) : null;
        id = old ? editId : "c" + crypto.randomBytes(8).toString("hex");
      }
      const p = typeof body.poster === "string" && body.poster.length <= 350000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(body.poster) ? body.poster : "";
      const doc: any = { kind: src.kind, url: src.url, title: t, genre: str(body.g, 30) || "Other", year: Math.floor(+body.y) || new Date().getFullYear(), minutes: Math.max(0, Math.floor(+body.m) || 0), description: str(body.d, 400), lang: str(body.lang, 30), age: str(body.age, 10), director: str(body.dir, 80), cast: str(body.cast, 200), poster: p, thumb: p || src.kind === "yt" ? "" : await pagePoster(src.url), featured: !!body.f };
      await movies.updateOne({ id }, { $set: doc, $setOnInsert: { id, createdAt: new Date() } }, { upsert: true });
      if (editId && editId !== id) await movies.deleteOne({ id: editId });
      return out(200, { ok: true });
    }
    const del = route.match(/^\/movies\/([\w-]{1,24})$/);
    if (del && m === "DELETE") {
      if (me.role !== "admin") return out(403, { error: "Admins only." });
      const result = await movies.deleteOne({ id: del[1] });
      if (!result.deletedCount) return out(404, { error: "Movie not found." });
      return out(200, { ok: true });
    }
    return out(404, { error: "Not found." });
  } catch (e) {
    console.error(e);
    const errorName = e instanceof Error ? e.name : "";
    if (errorName === "MongoServerSelectionError" || errorName === "MongoNetworkError") {
      return out(503, { error: "Cannot reach MongoDB. Check that MONGODB_URI is correct, the cluster is running, this computer's public IP is allowed in Atlas Network Access, and outbound port 27017 is open." });
    }
    if (errorName === "MongoParseError") {
      return out(503, { error: "MONGODB_URI is invalid. Check the connection string in your .env file." });
    }
    return out(500, { error: "Something went wrong. Please try again." });
  }
};
