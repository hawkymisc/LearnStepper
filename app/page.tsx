import type { Metadata } from "next";
import { LearnStepperApp } from "./frontend/learnstepper-app";

export const metadata: Metadata = {
  title: "LearnStepper — 学びを、一歩ずつ確かなものに",
  description:
    "目標・根拠・理解度をApplication Coreとつなぐ、対話型AI学習デスクトップアプリです。",
};

export default function Home() {
  return <LearnStepperApp />;
}
