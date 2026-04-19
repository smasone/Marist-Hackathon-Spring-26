import { selectFaqExcerptsForQuestion } from "./officialParkingRulesService";

describe("selectFaqExcerptsForQuestion", () => {
  it("returns a clipped excerpt when the FAQ plain text is one large block", () => {
    const pad = "navigation ".repeat(400);
    const needle =
      "Commuter students will park on east campus for the semester according to this demo paragraph.";
    const plain = `${pad}${needle}${pad}`;
    const excerpts = selectFaqExcerptsForQuestion(
      "where will commuter students be assigned to park?",
      plain
    );
    expect(excerpts.length).toBeGreaterThan(0);
    expect(excerpts.join(" ").toLowerCase()).toContain("commuter students will park");
  });
});
