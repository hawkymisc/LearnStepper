import type { Metadata } from "next";
import { LearningPrototype } from "./prototype-client";

export const metadata: Metadata = {
  title: "LearnStepper — 学びを、一歩ずつ確かなものに",
  description:
    "目標・根拠・理解度をひとつにつなぐ、対話型AI学習アプリのプロトタイプです。",
};

export default function Home() {
  return <LearningPrototype />;
}
