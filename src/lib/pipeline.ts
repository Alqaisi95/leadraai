/** Lead fields a pipeline stage can require before an opportunity enters it. */
export const REQUIRABLE_FIELDS: Record<string, string> = {
  phone: "رقم الهاتف",
  fullName: "الاسم",
  email: "البريد",
  budgetMax: "الميزانية",
  area: "المنطقة",
  propertyType: "نوع العقار",
  interestedProjectId: "المشروع المهتم به",
};

export function missingRequirements(lead: Record<string, unknown>, requires: string[]): string[] {
  return requires.filter((f) => f in REQUIRABLE_FIELDS && !lead[f]).map((f) => REQUIRABLE_FIELDS[f]);
}
