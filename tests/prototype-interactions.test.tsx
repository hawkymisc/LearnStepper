import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { LearningPrototype } from "../app/prototype-client";

describe("LearnStepper prototype journeys", () => {
  test("completes three exercises and reflects the result in progress", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "学習を再開" }));
    expect(document.querySelector('[data-screen="lesson"]')).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "演習を始める" }));

    for (const answer of ["両辺に 7 を足す", "両辺を 3 で割る", "元の式へ代入して左右が等しいか確認する"]) {
      await user.click(screen.getByRole("button", { name: new RegExp(answer) }));
      await user.click(screen.getByRole("button", { name: "回答を確認" }));
      expect(screen.getByText("正解です")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: /次の問題へ|3問の結果を進捗へ反映/ }));
    }

    expect(document.querySelector('[data-screen="progress"]')).not.toBeNull();
    expect(screen.getByText("今回の演習 3/3問 · 82%")).toBeTruthy();
  });

  test("finishes remediation and returns to the origin lesson", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "学習を再開" }));
    await user.click(screen.getByRole("button", { name: "前提を確認する" }));
    await user.click(screen.getByRole("button", { name: "補習を始める" }));
    expect(screen.getByText("等式の性質を、天びんで確認")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /左右の等しい関係を保ちながら/ }));
    await user.click(screen.getByRole("button", { name: "1問目を確認" }));
    await user.click(screen.getByRole("button", { name: /xの係数を1にするため/ }));
    await user.click(screen.getByRole("button", { name: "復帰条件を確認" }));
    await user.click(screen.getByRole("button", { name: "元のレッスンへ戻る" }));

    expect(screen.getByText("今日は、一次方程式を実際に解く流れを整理します。")).toBeTruthy();
    expect(screen.queryByText("補習中 · 約10分")).toBeNull();
  });

  test("does not unlock remediation return for an incorrect reason", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "学習を再開" }));
    await user.click(screen.getByRole("button", { name: "前提を確認する" }));
    await user.click(screen.getByRole("button", { name: "補習を始める" }));
    await user.click(screen.getByRole("button", { name: /3を反対側へ移すと/ }));
    await user.click(screen.getByRole("button", { name: "1問目を確認" }));

    expect(screen.queryByRole("button", { name: "元のレッスンへ戻る" })).toBeNull();
    expect(screen.getByText(/両辺へ同じ操作を行う理由/)).toBeTruthy();
  });

  test("keeps a sent question visible when connection is lost", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "学習を再開" }));
    const composer = screen.getByRole("textbox", { name: "質問を入力" });
    await user.type(composer, "両辺に同じ操作をする理由は何ですか");
    await user.click(screen.getByRole("button", { name: "質問を送信" }));
    await user.click(screen.getByRole("button", { name: "オンライン" }));

    expect(screen.getByText("両辺に同じ操作をする理由は何ですか")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("送信した質問は保持されています");
  });

  test("completes a generated answer and accepts a following question", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "学習を再開" }));
    const composer = screen.getByRole("textbox", { name: "質問を入力" });
    await user.type(composer, "なぜ両辺へ同じ操作をしますか");
    await user.click(screen.getByRole("button", { name: "質問を送信" }));

    await waitFor(() => expect(screen.getByText("LearnStepper · 回答完了")).toBeTruthy(), { timeout: 2500 });
    const firstAnswer = screen.getByText(/等式は左右が同じ値である関係です/);
    await user.type(composer, "別の例も教えてください");
    await user.click(screen.getByRole("button", { name: "質問を送信" }));
    expect(firstAnswer.isConnected).toBe(true);
    await waitFor(() => expect(screen.getAllByText("LearnStepper · 回答完了")).toHaveLength(2), { timeout: 2500 });
  });

  test("retains a setup draft after leaving the flow", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "新しい学習をつくる" }));
    await user.click(screen.getByRole("radio", { name: /自由なテーマを学ぶ/ }));
    const topic = screen.getByRole("textbox", { name: "学びたいテーマ" });
    const purpose = screen.getByRole("textbox", { name: "学習目的" });
    await user.clear(topic);
    await user.type(topic, "線形代数");
    await user.clear(purpose);
    await user.type(purpose, "行列を使ってデータを説明する");
    await user.click(screen.getByRole("button", { name: "ホーム" }));
    expect(screen.getByText("作成途中の学習プランがあります")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /設定を再開/ }));
    expect((screen.getByRole("radio", { name: /自由なテーマを学ぶ/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("textbox", { name: "学びたいテーマ" }) as HTMLInputElement).value).toBe("線形代数");
    expect((screen.getByRole("textbox", { name: "学習目的" }) as HTMLTextAreaElement).value).toBe("行列を使ってデータを説明する");
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    expect(screen.getByText(/線形代数を、行列を使ってデータを説明する/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    expect(screen.getByText("線形代数について、現在の理解に最も近いものはどれですか。")).toBeTruthy();
  });

  test("offers exactly the seven MVP curriculum jurisdictions", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "新しい学習をつくる" }));
    const jurisdiction = screen.getByRole("combobox", { name: "教育管轄" });
    expect(within(jurisdiction).getAllByRole("option")).toHaveLength(7);
    expect(within(jurisdiction).queryByRole("option", { name: /UAE/ })).toBeNull();
    await user.selectOptions(jurisdiction, "ny");
    expect(screen.getByRole("combobox", { name: "教育段階・学年" }).textContent).toContain("Grade 7");
    expect(screen.queryByRole("option", { name: "中学校・1年" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "教育課程版" }).textContent).toContain("Next Generation Standards 現行版");
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    expect(screen.getByText(/New York State Next Generation Mathematics/)).toBeTruthy();
    expect(screen.queryByText(/中学校学習指導要領/)).toBeNull();
  });

  test("starts a second project from a fresh setup", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "新しい学習をつくる" }));
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    await user.click(screen.getByRole("button", { name: "診断をスキップして計画へ" }));
    await user.click(screen.getByRole("button", { name: /計画を承認して始める/ }));
    await user.click(screen.getByRole("button", { name: "ホーム" }));
    await user.click(screen.getByRole("button", { name: "新しい学習をつくる" }));

    expect(screen.getByText("何を、どこまで学びますか。")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /教育課程に沿って学ぶ/ }) as HTMLInputElement).checked).toBe(true);
  });

  test("runs all three diagnosis questions before plan review", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "新しい学習をつくる" }));
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    await user.click(screen.getByRole("button", { name: "次へ進む" }));

    for (const answer of ["5", "7", "4を足す"]) {
      await user.click(screen.getByRole("button", { name: answer }));
      await user.click(screen.getByRole("button", { name: /次の問題へ|次へ進む/ }));
    }

    expect(screen.getByText("6週間の学習計画ができました。")).toBeTruthy();
  });

  test("carries a free topic into the learning session", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "新しい学習をつくる" }));
    await user.click(screen.getByRole("radio", { name: /自由なテーマを学ぶ/ }));
    const topic = screen.getByRole("textbox", { name: "学びたいテーマ" });
    await user.clear(topic);
    await user.type(topic, "線形代数");
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    await user.click(screen.getByRole("button", { name: "診断をスキップして計画へ" }));
    await user.click(screen.getByRole("button", { name: /計画を承認して始める/ }));

    expect(screen.getByRole("heading", { name: "線形代数の全体像", level: 1 })).toBeTruthy();
    expect(screen.getByText("今日は、線形代数の全体像と学習の道筋を整理します。")).toBeTruthy();
    expect(screen.queryByText("今日は、一次方程式を実際に解く流れを整理します。")).toBeNull();
    await user.click(screen.getByRole("button", { name: "理解を確かめる" }));
    await user.click(screen.getByRole("button", { name: "ヒントを見る" }));
    expect(screen.getByText(/発行主体を確認できる根拠/)).toBeTruthy();
    expect(screen.queryByText(/両辺へ同じ操作/)).toBeNull();
    for (const [index, answer] of ["全体像と基本用語を具体例へ結び付ける", "学んだ概念を目的に近い例で説明する", "発行主体と版を確認した一次資料"].entries()) {
      await user.click(screen.getByRole("button", { name: new RegExp(answer) }));
      await user.click(screen.getByRole("button", { name: "回答を確認" }));
      if (index === 0) expect(screen.getByText(/評価証拠として「線形代数の理解」/)).toBeTruthy();
      await user.click(screen.getByRole("button", { name: /次の問題へ|3問の結果を進捗へ反映/ }));
    }
    expect(screen.getByText("線形代数 · 任意テーマ")).toBeTruthy();
    expect(screen.getByText("線形代数を目的に近い例へ適用できる")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ホーム" }));
    expect(screen.getByRole("heading", { name: "線形代数の全体像", level: 3 })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "ライブラリ" }));
    await user.click(screen.getByRole("tab", { name: "履歴・ノート" }));
    expect(screen.getByText("線形代数の目的と全体像")).toBeTruthy();
  });

  test("clears exercise and remediation state for a newly created project", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "学習を再開" }));
    await user.click(screen.getByRole("button", { name: "演習を始める" }));
    for (const answer of ["両辺に 7 を足す", "両辺を 3 で割る", "元の式へ代入して左右が等しいか確認する"]) {
      await user.click(screen.getByRole("button", { name: new RegExp(answer) }));
      await user.click(screen.getByRole("button", { name: "回答を確認" }));
      await user.click(screen.getByRole("button", { name: /次の問題へ|3問の結果を進捗へ反映/ }));
    }
    await user.click(screen.getByRole("button", { name: "学習へ戻る" }));
    await user.click(screen.getByRole("button", { name: "前提を確認する" }));
    await user.click(screen.getByRole("button", { name: "補習を始める" }));
    await user.click(screen.getByRole("button", { name: "ホーム" }));
    await user.click(screen.getByRole("button", { name: "新しい学習をつくる" }));
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    await user.click(screen.getByRole("button", { name: "次へ進む" }));
    await user.click(screen.getByRole("button", { name: "診断をスキップして計画へ" }));
    await user.click(screen.getByRole("button", { name: /計画を承認して始める/ }));

    expect(screen.queryByText("補習中 · 約10分")).toBeNull();
    await user.click(screen.getByRole("button", { name: "進捗" }));
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.queryByText(/今回の演習 3\/3問/)).toBeNull();
  });

  test("opens the compact goal and source context", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "学習を再開" }));
    await user.click(screen.getByRole("button", { name: "目標・根拠" }));
    const drawer = screen.getByRole("dialog", { name: "目標と根拠" });
    expect(within(drawer).getByText("今回の目標")).toBeTruthy();
    await user.click(within(drawer).getAllByRole("button", { name: /中学校学習指導要領/ })[0]);
    expect(screen.getByRole("dialog", { name: "中学校学習指導要領 · 数学 · 数と式" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "目標と根拠" })).toBeNull();
  });

  test("opens metadata for the selected source in the library", async () => {
    const user = userEvent.setup();
    render(<LearningPrototype />);

    await user.click(screen.getByRole("button", { name: "ライブラリ" }));
    const sourceRows = screen.getAllByRole("button", { name: "詳細を見る →" });
    await user.click(sourceRows[1]);

    expect(screen.getByRole("dialog", { name: "日本 数学指導ガイド" })).toBeTruthy();
    expect(screen.getByText("MVP保存版")).toBeTruthy();
  });
});
