#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
indexnow_ping.py — push-индексация в Яндекс/Bing по протоколу IndexNow.

Зачем: у статики главная боль — скорость обнаружения. Recrawl API
Яндекс.Вебмастера квотирован (для таджвид.рф замерено 150 URL/сутки),
IndexNow — push без квоты: пинг на деплой -> переобход за минуты. Google
IndexNow не читает: для него sitemap, и это ок.

Ключ: {INDEXNOW_KEY}.txt в корне сайта, содержимое = сам ключ. Ключ живёт
в .env уровнем выше репозитория (INDEXNOW_KEY) и в файле-корне; оба обязаны
совпадать, иначе IndexNow вернёт 403.

Мягкая деградация: нет ключа в .env или нет файла ключа в корне — печатается
предупреждение и скрипт выходит с кодом 0, чтобы не ронять деплой.

Идемпотентность: журнал perf/indexnow-log.json в формате {url: {endpoint: iso}}.
Кулдаун 24 ч считается ПО-ЭНДПОИНТНО: адрес, не прошедший на одном эндпоинте,
остаётся к нему готовым, даже если на другом отправлен. Записи старого формата
{url: iso} читаются как «отправлено на оба». --force снимает кулдаун. Пустой
список после фильтра -> выход без запроса (не шумим).

CLI:
  python3 scripts/indexnow_ping.py --init                 # создать ключ+файл
  python3 scripts/indexnow_ping.py --url https://...      # один/несколько URL
  python3 scripts/indexnow_ping.py --since-commit HEAD~1  # изменённые html
  python3 scripts/indexnow_ping.py --all                  # весь sitemap
  python3 scripts/indexnow_ping.py --url ... --dry-run    # без отправки
  python3 scripts/indexnow_ping.py --url ... --force      # снять кулдаун
"""
import argparse
import datetime
import json
import pathlib
import re
import subprocess
import sys
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
HOST = "xn--80aefbin9d.xn--p1ai"
BASE = f"https://{HOST}"
ENV = ROOT.parent / ".env"
LOG = ROOT / "perf" / "indexnow-log.json"
ENDPOINTS = ["https://yandex.com/indexnow", "https://api.indexnow.org/indexnow"]
COOLDOWN_H = 24


def read_env(name: str) -> str | None:
    if not ENV.exists():
        return None
    m = re.search(rf"^{name}=(.*)$", ENV.read_text(encoding="utf-8"), re.M)
    return m.group(1).strip() if m and m.group(1).strip() else None


def write_env(name: str, value: str) -> None:
    s = ENV.read_text(encoding="utf-8") if ENV.exists() else ""
    if re.search(rf"^{name}=.*$", s, re.M):
        s = re.sub(rf"^{name}=.*$", f"{name}={value}", s, flags=re.M)
    else:
        s = s.rstrip("\n") + f"\n{name}={value}\n"
    ENV.write_text(s, encoding="utf-8")


def key_init() -> str:
    key = read_env("INDEXNOW_KEY") or uuid.uuid4().hex
    write_env("INDEXNOW_KEY", key)
    (ROOT / f"{key}.txt").write_text(key, encoding="utf-8")
    print(f"ключ: {key}\nфайл: {key}.txt (закоммитить — он обязан быть публично доступен)")
    return key


def load_log() -> dict:
    return json.loads(LOG.read_text(encoding="utf-8")) if LOG.exists() else {}


def _parse_iso(s: str, tz: datetime.timezone) -> datetime.datetime:
    """Журнал мог быть записан naive-датой (старый формат) — приводим к aware,
    иначе `aware - naive` кидает TypeError и весь пинг падает."""
    dt = datetime.datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=tz)


def urls_from_sitemap() -> list[str]:
    sm = ROOT / "sitemap.xml"
    return re.findall(r"<loc>([^<]+)</loc>", sm.read_text(encoding="utf-8")) if sm.exists() else []


def urls_since(ref: str) -> list[str]:
    """Изменённые index.html -> URL. noindex-страницы пропускаем: пинговать
    то, что закрыто от индексации, — противоречие. Берутся только пути,
    кончающиеся на index.html, поэтому legal.html, level2.html и 404.html
    мимо — так и задумано, они служебные."""
    try:
        out = subprocess.run(["git", "diff", "--name-only", ref, "HEAD"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError as e:
        sys.exit(f"git diff не сработал: {e}")
    urls = []
    for line in out.splitlines():
        if not line.endswith("index.html"):
            continue
        f = ROOT / line
        if not f.exists():
            continue
        if 'name="robots" content="noindex' in f.read_text(encoding="utf-8", errors="ignore")[:2000]:
            continue
        if line == "index.html":
            urls.append(f"{BASE}/")
        else:
            rel = pathlib.Path(line).parent.as_posix()
            urls.append(f"{BASE}/{rel}/")
    return urls


def ping_endpoint(key: str, ep: str, urls: list[str], dry: bool) -> bool:
    """Пинг ОДНОГО эндпоинта. Успех фиксируется по-эндпоинтно (не «ok or good»):
    раньше падение indexnow.org при успехе Яндекса помечало URL пинганным для
    обоих, и 24ч-кулдаун блокировал ретрай упавшего."""
    payload = {"host": HOST, "key": key, "keyLocation": f"{BASE}/{key}.txt", "urlList": urls}
    if dry:
        print(f"  [dry] {ep} ← {len(urls)} URL")
        print(json.dumps(payload, ensure_ascii=False, indent=1)[:400])
        return True
    r = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "30",
         "-X", "POST", "-H", "Content-Type: application/json; charset=utf-8",
         "-d", json.dumps(payload), ep],
        capture_output=True, text=True)
    code = r.stdout.strip()
    good = code in ("200", "202")
    print(f"  {ep} -> {code} {'✅' if good else '❌'}")
    return good


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--init", action="store_true")
    ap.add_argument("--url", nargs="+")
    ap.add_argument("--since-commit")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.init:
        key_init()
        return

    key = read_env("INDEXNOW_KEY")
    if not key:
        print("⚠ INDEXNOW_KEY не задан — пинг пропущен. Заведи: python3 scripts/indexnow_ping.py --init")
        return
    if not (ROOT / f"{key}.txt").exists():
        print(f"⚠ нет файла ключа {key}.txt в корне — пинг пропущен. Прогони --init")
        return

    urls = a.url or (urls_from_sitemap() if a.all else urls_since(a.since_commit) if a.since_commit else [])
    if not urls:
        print("нечего пинговать")
        return

    log = load_log()
    now = datetime.datetime.now(datetime.timezone.utc)
    utc = datetime.timezone.utc

    def _last(url: str, ep: str):
        v = log.get(url)
        if v is None:
            return None
        if isinstance(v, str):        # legacy {url: iso} — считался пингом на оба эндпоинта
            return v
        return v.get(ep)

    # Кулдаун считаем ПО-ЭНДПОИНТНО: URL, упавший на одном эндпоинте, остаётся
    # к нему due, даже если на другом прошёл (журнал теперь {url: {ep: iso}}).
    due = {ep: [] for ep in ENDPOINTS}
    for u in urls:
        for ep in ENDPOINTS:
            if not a.force:
                last = _last(u, ep)
                if last and (now - _parse_iso(last, utc)).total_seconds() < COOLDOWN_H * 3600:
                    continue
            due[ep].append(u)

    if not any(due.values()):
        print("все URL уже пинговались недавно на оба эндпоинта — выходим")
        return
    for ep in ENDPOINTS:
        n_skip = len(urls) - len(due[ep])
        if n_skip and not a.force:
            print(f"  {ep}: пропущено (пинг <{COOLDOWN_H}ч назад): {n_skip}")

    if a.dry_run:
        for ep in ENDPOINTS:
            if due[ep]:
                ping_endpoint(key, ep, due[ep], True)
        return

    LOG.parent.mkdir(exist_ok=True)
    for ep in ENDPOINTS:
        if not due[ep]:
            continue
        print(f"IndexNow: {len(due[ep])} URL → {ep}")
        if ping_endpoint(key, ep, due[ep], False):
            for u in due[ep]:
                entry = log.get(u)
                if not isinstance(entry, dict):
                    entry = {}         # мигрируем legacy-строку в per-endpoint словарь
                entry[ep] = now.isoformat()
                log[u] = entry
    LOG.write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"журнал: {LOG.relative_to(ROOT)} ({len(log)} URL всего)")


if __name__ == "__main__":
    main()
