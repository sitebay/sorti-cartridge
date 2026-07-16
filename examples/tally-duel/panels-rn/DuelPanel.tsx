/**
 * Native (React Native) renderer for ui://duel/board — the optional upgrade
 * over the WebView template. The host mounts it with a NativePanelContext;
 * everything flows through `ctx.mcpFetch` (the host's authenticated MCP
 * bridge) — a native panel talks the SAME tool surface as the iframe.
 */

import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativePanelContext } from "../../../vendor/sorti-contract/index.ts";
import type { DuelViewModel } from "../panel/server.ts";

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 16 },
  title: { fontSize: 18, fontWeight: "600" },
  sub: { fontSize: 12, opacity: 0.7 },
  seats: { flexDirection: "row", gap: 12 },
  seat: { borderWidth: 1, borderRadius: 8, padding: 14, minWidth: 140, gap: 8 },
  score: { fontSize: 32, fontVariant: ["tabular-nums"] },
  button: { borderWidth: 1, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  banner: { fontSize: 14, fontWeight: "600" },
});

export function DuelPanelNative({ ctx }: { ctx: NativePanelContext }): React.ReactElement {
  const [vm, setVm] = React.useState<DuelViewModel | null>(null);

  const refresh = React.useCallback(async () => {
    const reply = await ctx.mcpFetch(ctx.panel.endpoint, "tools/call", {
      name: "duel.read_state",
      arguments: {},
    });
    const result = reply.result as { structuredContent?: DuelViewModel } | undefined;
    if (result?.structuredContent?.kind === "duel") setVm(result.structuredContent);
  }, [ctx]);

  React.useEffect(() => {
    void refresh();
  }, [refresh, ctx.refreshKey]);

  const act = React.useCallback(
    async (tool: string, playerId: string) => {
      await ctx.mcpFetch(ctx.panel.endpoint, "tools/call", { name: tool, arguments: { playerId } });
      await refresh();
    },
    [ctx, refresh],
  );

  if (!vm || !vm.active) {
    return (
      <View style={styles.root}>
        <Text style={styles.sub}>waiting for a run…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="duel-panel">
      <Text style={styles.title}>Tally Duel</Text>
      <Text style={styles.sub}>first to {vm.targetScore} wins</Text>
      {vm.winner ? <Text style={styles.banner}>{vm.winner.name} wins the duel</Text> : null}
      <View style={styles.seats}>
        {vm.players.map((player) => (
          <View key={player.id} style={styles.seat}>
            <Text>{player.name}</Text>
            <Text style={styles.score}>{player.score}</Text>
            <Pressable
              style={styles.button}
              disabled={!!vm.winner}
              onPress={() => void act("duel.tap", player.id)}
            >
              <Text>Tap +1</Text>
            </Pressable>
            <Pressable
              style={styles.button}
              disabled={!!vm.winner || player.boostsLeft <= 0}
              onPress={() => void act("duel.boost", player.id)}
            >
              <Text>Boost +3 ({player.boostsLeft})</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
