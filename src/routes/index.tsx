import { createFileRoute } from "@tanstack/react-router";
import { MineApp } from "@/components/mine/mine-app";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <MineApp />;
}
