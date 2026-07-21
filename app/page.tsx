import type { Metadata } from "next";
import { LearnStepperApp } from "./frontend/learnstepper-app";

export const metadata: Metadata = {
  title: "LearnStepper — 学びを、一歩ずつ確かなものに",
  description:
    "目標・対話・理解度をひとつにつなぐ、パーソナルAI学習デスクトップアプリです。",
};

export default function Home() {
  const rendererToken = process.env.LEARNSTEPPER_RENDERER_TOKEN;
  return <><meta name="learnstepper-renderer" content={rendererToken ?? "browser-preview"} /><LearnStepperApp /></>;
}
