import { Suspense } from "react";
import AdminApiClient from "./AdminApiClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <AdminApiClient />
    </Suspense>
  );
}


import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const ADMIN_KEY_LS = "social_ai_admin_key_v1";

function buildAdminHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem("admin_token_v1") || "";
  const key = window.localStorage.getItem(ADMIN_KEY_LS) || "";
  // Send both headers if present.
  // Reason: If an expired/invalid admin JWT remains in localStorage, backend auth would fail
  // unless we also send the x-admin-key.
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (key) h["x-admin-key"] = key;
  return h;
}

async function safeReadJsonMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.message || data?.error || data?.warn || "";
  } catch {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }
}

type Tab = "facebook" | "instagram" | "whatsapp";

type ConnectedPage = {
  id: number;
  pageId: string;
  pageName: string;
  updatedAt: string | null;
};

function normalizeConnectedPages(input: any): ConnectedPage[] {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .map((r: any) => {
      const idNum = Number(r?.id || 0);
      const pageId = String(r?.pageId || r?.page_id || r?.pageID || "").trim();
      const pageName = String(r?.pageName || r?.page_name || r?.name || "").trim();
      const updatedAt = (r?.updatedAt ?? r?.updated_at ?? null) as any;
      return {
        id: Number.isFinite(idNum) ? idNum : 0,
        pageId,
        pageName,
        updatedAt: updatedAt ? String(updatedAt) : null,
      };
    })
    .filter((p) => !!p.pageId);
}

type MetaPage = {
  id: string;
  name: string;
  access_token: string;
};

export default function ApiIntegrationPage() {
  const searchParams = useSearchParams();

  const API_BASE = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000",
    []
  );

  const initialTab = ((): Tab => {
    const t = String(searchParams.get("tab") || "").toLowerCase();
    if (t === "facebook" || t === "instagram" || t === "whatsapp") return t;
    return "facebook";
  })();

  const [tab, setTab] = useState<Tab>(initialTab);

  const [adminKey, setAdminKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(ADMIN_KEY_LS) || "";
  });

  const [connected, setConnected] = useState<ConnectedPage[]>([]);
  const [oauthState, setOauthState] = useState<string>(
    () => String(searchParams.get("state") || "").trim()
  );
  const [availablePages, setAvailablePages] = useState<MetaPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const persistAdminKey = (val: string) => {
    setAdminKey(val);
    try {
      localStorage.setItem(ADMIN_KEY_LS, val);
    } catch {
      // ignore
    }
  };

  const ensureAdmin = () => {
    const headersBase = buildAdminHeaders();
    if (!headersBase.Authorization && !headersBase["x-admin-key"]) {
      throw new Error(
        "Admin login করুন অথবা Admin API Key দিন (backend .env এর ADMIN_API_KEY)"
      );
    }
    return headersBase;
  };

  const loadConnectedPages = async (t: Tab) => {
    if (t !== "facebook" && t !== "instagram") return;
    setErr("");
    setOk("");
    setLoading(true);
    try {
      const headersBase = ensureAdmin();
      const res = await fetch(`${API_BASE}/api/integrations/${t}/pages`, {
        method: "GET",
        headers: { ...headersBase },
        cache: "no-store",
      });

      if (!res.ok) {
        const msg = await safeReadJsonMessage(res);
        throw new Error(msg || `Failed (${res.status})`);
      }
      const data = await res.json();
      // Support {pages:[...]} as well as {active:[...]} shapes.
      const pagesRaw = Array.isArray(data?.pages) ? data.pages : Array.isArray(data?.active) ? data.active : [];
      setConnected(normalizeConnectedPages(pagesRaw));
    } catch (e: any) {
      setErr(e?.message || "Failed to load pages");
    } finally {
      setLoading(false);
    }
  };

  const startOAuth = (t: "facebook" | "instagram") => {
    setErr("");
    setOk("");
    // Redirect to backend OAuth start
    window.location.href = `${API_BASE}/api/integrations/${t}/oauth/start`;
  };

  const fetchAvailablePages = async (t: "facebook" | "instagram", state: string) => {
    setErr("");
    setOk("");
    setAvailablePages([]);
    setSelectedPageId("");
    setLoading(true);
    try {
      const headersBase = ensureAdmin();
      const res = await fetch(
        `${API_BASE}/api/integrations/${t}/oauth/pages?state=${encodeURIComponent(state)}`,
        {
          method: "GET",
          headers: { ...headersBase },
          cache: "no-store",
        }
      );
      if (!res.ok) {
        const msg = await safeReadJsonMessage(res);
        throw new Error(msg || `Failed (${res.status})`);
      }
      const data = await res.json();
      const pages: MetaPage[] = Array.isArray(data?.pages) ? data.pages : [];
      setAvailablePages(pages);
      if (pages[0]?.id) setSelectedPageId(pages[0].id);
    } catch (e: any) {
      setErr(e?.message || "Failed to fetch pages");
    } finally {
      setLoading(false);
    }
  };

  const addSelectedPage = async (t: "facebook" | "instagram") => {
    setErr("");
    setOk("");
    setSaving(true);
    try {
      const headersBase = ensureAdmin();
      if (!oauthState) throw new Error("OAuth state missing. Connect again.");
      if (!selectedPageId) throw new Error("Please select a page");

      const res = await fetch(`${API_BASE}/api/integrations/${t}/oauth/select`, {
        method: "POST",
        headers: {
          ...headersBase,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state: oauthState, pageId: selectedPageId }),
      });
      if (!res.ok) {
        const msg = await safeReadJsonMessage(res);
        throw new Error(msg || `Failed (${res.status})`);
      }
      const data = await res.json();
      setOk(data?.warn ? `Added ✅ (but: ${String(data.warn)})` : "Added ✅");

      // If backend returns active list (some versions do), update immediately.
      if (Array.isArray((data as any)?.active)) {
        setConnected(normalizeConnectedPages((data as any).active));
      }
      // Refresh connected list
      await loadConnectedPages(t);
    } catch (e: any) {
      setErr(e?.message || "Failed to add page");
    } finally {
      setSaving(false);
    }
  };

  // Keep tab in sync with URL param changes (OAuth redirect)
  useEffect(() => {
    const t = String(searchParams.get("tab") || "").toLowerCase();
    if (t === "facebook" || t === "instagram" || t === "whatsapp") setTab(t);
    const st = String(searchParams.get("state") || "").trim();
    if (st) setOauthState(st);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Load connected pages when tab changes
  useEffect(() => {
    if (tab === "facebook" || tab === "instagram") loadConnectedPages(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // After OAuth redirect: fetch pages list for that state
  useEffect(() => {
    if (!oauthState) return;
    if (tab !== "facebook" && tab !== "instagram") return;
    fetchAvailablePages(tab, oauthState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthState, tab]);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">🔌 API Integration</h1>

      <div className="mt-4 rounded-lg border p-4">
        <div className="text-sm text-gray-600">Admin API Key (optional):</div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={adminKey}
            onChange={(e) => persistAdminKey(e.target.value)}
            placeholder="ADMIN_API_KEY (optional if admin login token exists)"
            className="w-full rounded border px-3 py-2 text-sm"
          />
          <button
            onClick={() => {
              try {
                localStorage.removeItem(ADMIN_KEY_LS);
              } catch {}
              setAdminKey("");
            }}
            className="rounded border px-3 py-2 text-sm"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => setTab("facebook")}
          className={`rounded px-4 py-2 text-sm border ${
            tab === "facebook" ? "bg-black text-white" : "bg-white"
          }`}
        >
          Facebook Page
        </button>
        <button
          onClick={() => setTab("instagram")}
          className={`rounded px-4 py-2 text-sm border ${
            tab === "instagram" ? "bg-black text-white" : "bg-white"
          }`}
        >
          Instagram
        </button>
        <button
          onClick={() => setTab("whatsapp")}
          className={`rounded px-4 py-2 text-sm border ${
            tab === "whatsapp" ? "bg-black text-white" : "bg-white"
          }`}
        >
          WhatsApp
        </button>
      </div>

      {tab === "whatsapp" ? (
        <div className="mt-6 rounded border p-6">
          <div className="text-lg font-semibold">WhatsApp</div>
          <p className="mt-2 text-gray-600">এই অংশটা পরে যোগ হবে।</p>
        </div>
      ) : (
        <div className="mt-6 rounded border p-6">
          <div className="text-lg font-semibold">
            {tab === "facebook" ? "Facebook Page" : "Instagram"}
          </div>
          <p className="mt-2 text-gray-600">
            {tab === "facebook"
              ? "Connect → permission দিন → page select করে Add করুন।"
              : "Connect → permission দিন → page select করে Add করুন (IG DM চালাতে Meta App Review লাগতে পারে)।"}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => startOAuth(tab)}
              className="rounded bg-black px-4 py-2 text-sm text-white"
            >
              {tab === "facebook" ? "Connect Facebook" : "Connect Instagram"}
            </button>
            <button
              onClick={() => loadConnectedPages(tab)}
              disabled={loading}
              className="rounded border px-4 py-2 text-sm"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {/* Available pages (after OAuth) */}
          {oauthState && availablePages.length ? (
            <div className="mt-6 rounded bg-gray-50 p-4">
              <div className="font-medium">Select a page to add</div>
              <div className="mt-3 grid gap-2">
                <select
                  value={selectedPageId}
                  onChange={(e) => setSelectedPageId(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  {availablePages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => addSelectedPage(tab)}
                  disabled={saving || !selectedPageId}
                  className="w-fit rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  {saving ? "Adding..." : "Add Page"}
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                (OAuth state auto-expire হয়; কাজ না করলে আবার Connect করুন।)
              </div>
            </div>
          ) : oauthState && !availablePages.length ? (
            <div className="mt-6 rounded bg-gray-50 p-4 text-sm text-gray-700">
              OAuth connected, কিন্তু page list load হয়নি। Refresh বা Connect আবার দিন।
            </div>
          ) : null}

          {/* Messages */}
          {err ? (
            <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {err}
            </div>
          ) : null}
          {ok ? (
            <div className="mt-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              {ok}
            </div>
          ) : null}

          {/* Connected pages */}
          <div className="mt-6 rounded bg-gray-50 p-4 text-sm">
            <div className="font-medium">Connected Pages</div>
            <div className="mt-2 grid gap-2">
              {connected.length ? (
                connected.map((p) => (
                  <div
                    key={p.pageId || String(p.id)}
                    className="flex flex-col gap-1 rounded border bg-white px-3 py-2"
                  >
                    <div className="font-medium">{p.pageName || "(no name)"}</div>
                    <div className="text-gray-600">Page ID: {p.pageId}</div>
                  </div>
                ))
              ) : (
                <div className="text-gray-600">No pages connected yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
