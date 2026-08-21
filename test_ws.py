"""Blast Buddies Deno 服务器本地联机测试
测试项：
1. 静态文件 index.html 可访问
2. host create -> 得到房间码
3. guest join -> host 收到 peer connected
4. guest input -> host 收到 input
5. host state -> guest 收到 state
6. guest 断开 -> host 收到 peer disconnected
7. host 断开后房间清理（再 join 应报房间不存在）
"""
import asyncio, json, sys
import websockets

WS_URL = "ws://127.0.0.1:8000"
HTTP_URL = "http://127.0.0.1:8000/"
PASS = 0
FAIL = 0

def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")

async def recv_msg(ws, timeout=3.0):
    return json.loads(await asyncio.wait_for(ws.recv(), timeout))

async def main():
    # 1. 静态文件
    try:
        import urllib.request
        with urllib.request.urlopen(HTTP_URL, timeout=5) as r:
            html = r.read().decode("utf-8", "ignore")
            check("静态 index.html 可访问", r.status == 200 and "Blast" in html or "blast" in html.lower(), f"status={r.status}")
    except Exception as e:
        check("静态 index.html 可访问", False, str(e))

    async with websockets.connect(WS_URL) as host, websockets.connect(WS_URL) as guest:
        # 2. host create
        await host.send(json.dumps({"t": "create"}))
        created = await recv_msg(host)
        check("host create 得到房间码", created.get("t") == "created" and len(str(created.get("room"))) == 4, str(created))
        room = created["room"]

        # 3. guest join
        await guest.send(json.dumps({"t": "join", "room": room}))
        joined = await recv_msg(guest)
        check("guest join 成功", joined.get("t") == "joined" and joined.get("room") == room, str(joined))
        # host 应收到 peer connected（可能先收到 join 通知，两者都算；这里直接等 peer）
        peer = await recv_msg(host)
        check("host 收到 peer connected", peer.get("t") == "peer" and peer.get("state") == "connected", str(peer))

        # 4. guest -> host input
        await guest.send(json.dumps({"t": "input", "d": {"x": 12.5, "fire": True}}))
        inp = await recv_msg(host)
        check("guest input 转发给 host", inp.get("t") == "input" and inp.get("d", {}).get("x") == 12.5, str(inp))

        # 5. host -> guest state
        await host.send(json.dumps({"t": "state", "d": {"hp": 3, "score": 100}}))
        st = await recv_msg(guest)
        check("host state 转发给 guest", st.get("t") == "state" and st.get("d", {}).get("score") == 100, str(st))

        # 6. guest 断开 -> host 收到 disconnected
        await guest.close()
        disc = await recv_msg(host)
        check("host 收到 peer disconnected", disc.get("t") == "peer" and disc.get("state") == "disconnected", str(disc))

    # 7. host 断开后房间清理
    async with websockets.connect(WS_URL) as host2, websockets.connect(WS_URL) as guest2:
        await host2.send(json.dumps({"t": "create"}))
        created2 = await recv_msg(host2)
        room2 = created2["room"]
        await host2.close()
        await asyncio.sleep(0.3)
        await guest2.send(json.dumps({"t": "join", "room": room2}))
        err = await recv_msg(guest2)
        check("host 断开后房间已清理", err.get("t") == "error", str(err))

    # 8. 错误房间号
    async with websockets.connect(WS_URL) as g:
        await g.send(json.dumps({"t": "join", "room": "9999"}))
        err = await recv_msg(g)
        check("不存在的房间报错", err.get("t") == "error", str(err))

    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    sys.exit(1 if FAIL else 0)

asyncio.run(main())
