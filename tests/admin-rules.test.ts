import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { memberChangeError, temporaryPassword } from "../src/lib/members";
import { missingRequirements } from "../src/lib/pipeline";
import { docxXmlToText, extractText, typeFromName } from "../src/lib/ai/extract";

describe("memberChangeError", () => {
  const admin = { id: "m1", role: "ORG_ADMIN", status: "ACTIVE" };
  const agent = { id: "m2", role: "AGENT", status: "ACTIVE" };

  it("blocks changing yourself", () => {
    expect(memberChangeError({ actorMemberId: "m1", target: admin, nextRole: "AGENT", activeAdminCount: 2 })).toBe("SELF_CHANGE");
  });
  it("keeps at least one active admin", () => {
    expect(memberChangeError({ actorMemberId: "x", target: admin, nextStatus: "SUSPENDED", activeAdminCount: 1 })).toBe("LAST_ADMIN");
    expect(memberChangeError({ actorMemberId: "x", target: admin, nextRole: "VIEWER", activeAdminCount: 1 })).toBe("LAST_ADMIN");
    expect(memberChangeError({ actorMemberId: "x", target: admin, nextRole: "VIEWER", activeAdminCount: 2 })).toBeNull();
  });
  it("rejects platform roles", () => {
    expect(memberChangeError({ actorMemberId: "x", target: agent, nextRole: "SUPER_ADMIN", activeAdminCount: 1 })).toBe("INVALID_ROLE");
  });
  it("allows ordinary changes and no-ops", () => {
    expect(memberChangeError({ actorMemberId: "x", target: agent, nextRole: "SALES_MANAGER", activeAdminCount: 1 })).toBeNull();
    expect(memberChangeError({ actorMemberId: "m2", target: agent, nextRole: "AGENT", activeAdminCount: 1 })).toBeNull();
  });
});

describe("temporaryPassword", () => {
  it("is 14 readable characters and different each time", () => {
    const a = temporaryPassword();
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]{14}$/);
    expect(temporaryPassword()).not.toBe(a);
  });
});

describe("missingRequirements", () => {
  it("names missing fields in Arabic and ignores unknown keys", () => {
    expect(missingRequirements({ phone: "", budgetMax: 1 }, ["phone", "budgetMax", "hacked"])).toEqual(["رقم الهاتف"]);
  });
});

describe("knowledge extraction", () => {
  it("turns docx XML into paragraphs", () => {
    const xml = '<w:body><w:p><w:r><w:t>خطة الدفع</w:t></w:r></w:p><w:p><w:r><w:t>20% &amp; أقساط</w:t><w:tab/><w:t>60 شهراً</w:t></w:r></w:p></w:body>';
    expect(docxXmlToText(xml)).toBe("خطة الدفع\n20% & أقساط\t60 شهراً");
  });

  it("extracts text from a real .docx archive", async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>مقدمة عن مشروع النخيل السكني في بغداد</w:t></w:r></w:p></w:body></w:document>';
    const bytes = zipSync({ "word/document.xml": strToU8(xml) });
    const file = new File([bytes], "brochure.docx");
    const out = await extractText(file);
    expect(out.type).toBe("DOCX");
    expect(out.text).toContain("مشروع النخيل");
  });

  it("rejects unsupported and empty files", async () => {
    expect(typeFromName("photo.jpg")).toBeNull();
    await expect(extractText(new File(["x"], "a.jpg"))).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(extractText(new File(["  "], "a.txt"))).rejects.toMatchObject({ code: "EMPTY_TEXT" });
  });
});
