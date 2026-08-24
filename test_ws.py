"""Blast Buddies Deno 服务器本地联机测试（v3：多人房间 + 公开/私有）
测试项：
1.  静态文件 index.html 可访问
2.  create 带参数：max=3, mode=public -> created 带 cap/mode
3.  list：公开房间可见（n=1, cap=3）
4.  guest1 join -> slot=2，host 收 peer connected(slot=2)
5.  list：n=2，仍未满可见
6.  guest2 join -> slot=3，host 收 peer connected(slot=3)
7.  guest3 join（cap=3 已满）-> error 房间已满
8.  list：满员房间不再出现
9.  多路 input 各自带 slot 转发给 host
10. host state 广播给所有 guest
11. guest1 断开 -> host 收 peer disconnected(slot=2)，slot 释放后重进拿回 slot=2
12. 私有房间：list 不可见，凭房间号可加入
13. 不限人数：无 max 创建，3 个 guest 都能进（slot 2/3/4）
14. ping/pong 服务器直接回
15. host 断开后房间清理
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

async def drain(ws, sec=0.3):
    """吃掉缓冲区里的消息"""
    try:
        while True:
            await asyncio.wait_for(ws.recv(), sec)
    except asyncio.TimeoutError:
        pass

async def main():
    # 1. 静态文件
    try:
        import urllib.request
        with urllib.request.urlopen(HTTP_URL, timeout=5) as r:
            html = r.read().decode("utf-8", "ignore")
            check("静态 index.html 可访问", r.status == 200 and "blast" in html.lower(), f"status={r.status}")
    except Exception as e:
        check("静态 index.html 可访问", False, str(e))

    # ===== 公开房间（cap=3）=====
    async with websockets.connect(WS_URL) as host:
        # 2. create 带参数
        await host.send(json.dumps({"t": "create", "max": 3, "mode": "public"}))
        created = await recv_msg(host)
        check("create(max=3, public) 返回 cap/mode",
              created.get("t") == "created" and created.get("cap") == 3 and created.get("mode") == "public",
              str(created))
        room = created["room"]

        # 3. list：可见
        async with websockets.connect(WS_URL) as lobby:
            await lobby.send(json.dumps({"t": "list"}))
            rooms = await recv_msg(lobby)
            entry = next((r for r in rooms.get("d", []) if r["room"] == room), None)
            check("list 显示公开房间 n=1/cap=3", entry is not None and entry["n"] == 1 and entry["cap"] == 3, str(rooms))

        # 4. guest1 加入
        g1 = await websockets.connect(WS_URL)
        await g1.send(json.dumps({"t": "join", "room": room}))
        j1 = await recv_msg(g1)
        check("guest1 join 得到 slot=2", j1.get("t") == "joined" and j1.get("slot") == 2, str(j1))
        peer1 = await recv_msg(host)
        check("host 收 peer connected slot=2",
              peer1.get("t") == "peer" and peer1.get("state") == "connected" and peer1.get("slot") == 2, str(peer1))

        # 5. list：n=2 仍可见
        async with websockets.connect(WS_URL) as lobby:
            await lobby.send(json.dumps({"t": "list"}))
            rooms = await recv_msg(lobby)
            entry = next((r for r in rooms.get("d", []) if r["room"] == room), None)
            check("list 房间人数更新为 2", entry is not None and entry["n"] == 2, str(rooms))

        # 6. guest2 加入
        g2 = await websockets.connect(WS_URL)
        await g2.send(json.dumps({"t": "join", "room": room}))
        j2 = await recv_msg(g2)
        check("guest2 join 得到 slot=3", j2.get("t") == "joined" and j2.get("slot") == 3, str(j2))
        peer2 = await recv_msg(host)
        check("host 收 peer connected slot=3",
              peer2.get("t") == "peer" and peer2.get("state") == "connected" and peer2.get("slot") == 3, str(peer2))

        # 7. guest3 加入：满员
        g3 = await websockets.connect(WS_URL)
        await g3.send(json.dumps({"t": "join", "room": room}))
        err = await recv_msg(g3)
        check("满员加入被拒（3/3）", err.get("t") == "error" and "已满" in err.get("msg", ""), str(err))
        await g3.close()

        # 8. list：满员不再显示
        async with websockets.connect(WS_URL) as lobby:
            await lobby.send(json.dumps({"t": "list"}))
            rooms = await recv_msg(lobby)
            entry = next((r for r in rooms.get("d", []) if r["room"] == room), None)
            check("满员房间从列表移除", entry is None, str(rooms))

        # 9. 多路 input 各自带 slot
        await g1.send(json.dumps({"t": "input", "d": {"x": 1}}))
        await g2.send(json.dumps({"t": "input", "d": {"x": 2}}))
        msgs = [await recv_msg(host), await recv_msg(host)]
        by_slot = {m.get("slot"): m for m in msgs if m.get("t") == "input"}
        check("input 按 slot 区分转发",
              by_slot.get(2, {}).get("d", {}).get("x") == 1 and by_slot.get(3, {}).get("d", {}).get("x") == 2, str(msgs))
        # input 中继也会发给房间内其他 guest（对方收到无妨，客户端只处理已知类型）
        await drain(g1)
        await drain(g2)

        # 10. state 广播给所有 guest
        await host.send(json.dumps({"t": "state", "d": {"score": 100}}))
        s1 = await recv_msg(g1)
        s2 = await recv_msg(g2)
        check("state 广播给全部 guest",
              s1.get("t") == "state" and s2.get("t") == "state" and s1.get("d", {}).get("score") == 100, f"{s1} {s2}")

        # 14. ping/pong
        await host.send(json.dumps({"t": "ping", "d": 12345}))
        p1 = await recv_msg(host)
        check("host ping -> pong", p1.get("t") == "pong" and p1.get("d") == 12345, str(p1))
        await g1.send(json.dumps({"t": "ping", "d": 67890}))
        p2 = await recv_msg(g1)
        check("guest ping -> pong", p2.get("t") == "pong" and p2.get("d") == 67890, str(p2))

        # 11. guest1 断开：slot 释放
        await g1.close()
        disc = await recv_msg(host)
        check("host 收 peer disconnected slot=2",
              disc.get("t") == "peer" and disc.get("state") == "disconnected" and disc.get("slot") == 2, str(disc))
        g1b = await websockets.connect(WS_URL)
        await g1b.send(json.dumps({"t": "join", "room": room}))
        j1b = await recv_msg(g1b)
        check("断开后 slot=2 释放复用", j1b.get("t") == "joined" and j1b.get("slot") == 2, str(j1b))
        await recv_msg(host)  # peer connected
        await g1b.close()
        await recv_msg(host)  # peer disconnected
        await g2.close()
        await drain(host)  # 可能的 peer disconnected

    # ===== 私有房间 =====
    async with websockets.connect(WS_URL) as host2, websockets.connect(WS_URL) as lobby2:
        await host2.send(json.dumps({"t": "create", "max": 0, "mode": "private"}))
        c2 = await recv_msg(host2)
        room2 = c2["room"]
        check("create private 返回 mode=private", c2.get("mode") == "private", str(c2))
        await lobby2.send(json.dumps({"t": "list"}))
        rooms2 = await recv_msg(lobby2)
        check("私有房间 list 不可见", all(r["room"] != room2 for r in rooms2.get("d", [])), str(rooms2))
        gp = await websockets.connect(WS_URL)
        await gp.send(json.dumps({"t": "join", "room": room2}))
        jp = await recv_msg(gp)
        check("私有房间凭房间号可加入", jp.get("t") == "joined" and jp.get("slot") == 2, str(jp))
        await gp.close()
        await drain(host2)

    # ===== 不限人数 =====
    async with websockets.connect(WS_URL) as host3:
        await host3.send(json.dumps({"t": "create"}))  # 无参数 = 不限
        c3 = await recv_msg(host3)
        room3 = c3["room"]
        check("create 无参数 = cap 0（不限）", c3.get("cap") == 0 and c3.get("mode") == "public", str(c3))
        slots = []
        gs = []
        for i in range(3):
            g = await websockets.connect(WS_URL)
            await g.send(json.dumps({"t": "join", "room": room3}))
            j = await recv_msg(g)
            slots.append(j.get("slot"))
            gs.append(g)
        check("不限人数：3 个 guest 全部加入（slot 2/3/4）", slots == [2, 3, 4], str(slots))
        for g in gs:
            await g.close()
        await drain(host3)

    # ===== 房间清理 & 错误房间号 =====
    async with websockets.connect(WS_URL) as host4:
        await host4.send(json.dumps({"t": "create"}))
        room4 = (await recv_msg(host4))["room"]
        await host4.close()
        await asyncio.sleep(0.3)
        async with websockets.connect(WS_URL) as g4:
            await g4.send(json.dumps({"t": "join", "room": room4}))
            err = await recv_msg(g4)
            check("host 断开后房间已清理", err.get("t") == "error", str(err))

    async with websockets.connect(WS_URL) as g5:
        await g5.send(json.dumps({"t": "join", "room": "9999"}))
        err = await recv_msg(g5)
        check("不存在的房间报错", err.get("t") == "error", str(err))

    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    sys.exit(1 if FAIL else 0)

asyncio.run(main())
