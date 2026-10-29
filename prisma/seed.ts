/**
 * Seed: demo organization with full team, pipeline, project, units,
 * and default scoring rules matching the requirements doc §4.7.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("Leadra@2026!", 12);

  const org = await prisma.organization.create({
    data: { name: "شركة الديار العقارية (تجريبي)", country: "IQ", timezone: "Asia/Baghdad", language: "AR" },
  });

  const roles = [
    { email: "admin@demo.leadra.ai", name: "أحمد المدير", role: "ORG_ADMIN" },
    { email: "manager@demo.leadra.ai", name: "سارة مديرة المبيعات", role: "SALES_MANAGER" },
    { email: "agent1@demo.leadra.ai", name: "علي موظف مبيعات", role: "AGENT" },
    { email: "agent2@demo.leadra.ai", name: "زينب موظفة مبيعات", role: "AGENT" },
    { email: "marketing@demo.leadra.ai", name: "حسن التسويق", role: "MARKETING" },
  ] as const;

  const members: Record<string, string> = {};
  for (const r of roles) {
    const user = await prisma.user.create({
      data: { email: r.email, fullName: r.name, passwordHash: password, language: "AR" },
    });
    const m = await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: r.role, status: "ACTIVE", joinedAt: new Date() },
    });
    members[r.role + "_" + r.email] = m.id;
  }

  // Default pipeline — 10 stages from requirements §4.8
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: org.id, name: "مسار المبيعات الافتراضي", isDefault: true },
  });
  const stageNames = [
    "جديد", "تأهيل أولي", "مؤهل", "تواصل بشري", "موعد زيارة",
    "تمت الزيارة", "تفاوض", "حجز", "بيع", "مفقود / غير مؤهل",
  ];
  for (let i = 0; i < stageNames.length; i++) {
    await prisma.pipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        name: stageNames[i],
        order: i + 1,
        isWon: stageNames[i] === "بيع",
        isLost: i === stageNames.length - 1,
        entryRules: stageNames[i] === "موعد زيارة" ? { requires: ["phone"] } : undefined,
      },
    });
  }

  // Demo project + units
  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      name: "مجمع الياسمين السكني",
      location: "بغداد — المنصور",
      developer: "شركة الديار",
      projectType: "سكني",
      status: "UNDER_CONSTRUCTION",
      startingPrice: 95000,
      amenities: ["مواقف سيارات", "حديقة", "أمن 24/7"],
      paymentPlans: [{ name: "كاش", downPayment: 100 }, { name: "أقساط 24 شهر", downPayment: 30, months: 24 }],
    },
  });

  const building = await prisma.building.create({
    data: { projectId: project.id, name: "بناية A", floors: 8 },
  });

  for (let f = 1; f <= 3; f++) {
    for (const [suffix, type, beds, area, price] of [
      ["01", "شقة", 2, 120, 95000],
      ["02", "شقة", 3, 155, 125000],
    ] as const) {
      await prisma.unit.create({
        data: {
          organizationId: org.id,
          projectId: project.id,
          buildingId: building.id,
          unitNumber: `A-${f}${suffix}`,
          floor: f,
          unitType: type,
          bedrooms: beds,
          bathrooms: 2,
          areaSqm: area,
          price,
          status: "AVAILABLE",
        },
      });
    }
  }

  // Default scoring rules — §4.7
  const rules = [
    { event: "BUDGET_PROVIDED", points: 20, label: "حدد الميزانية" },
    { event: "AREA_PROVIDED", points: 10, label: "حدد المنطقة" },
    { event: "PHONE_SHARED", points: 15, label: "شارك رقم الهاتف" },
    { event: "VISIT_REQUESTED", points: 30, label: "طلب موعد زيارة" },
    { event: "NEAR_TERM_PURCHASE", points: 15, label: "موعد شراء قريب" },
    { event: "BUDGET_MISMATCH", points: -20, label: "عدم توافق الميزانية" },
    { event: "NO_REPLY_48H", points: -8, label: "عدم الرد خلال يومين" },
    { event: "SPAM_MESSAGE", points: -100, label: "رسالة Spam" },
  ];
  for (const r of rules) {
    await prisma.scoringRule.create({ data: { organizationId: org.id, ...r } });
  }

  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      planKey: "trial",
      status: "TRIAL",
      trialEndsAt: new Date(Date.now() + 14 * 86400_000),
      limits: { igAccounts: 1, users: 5, monthlyConversations: 500, aiTokens: 1_000_000, storageMb: 512 },
    },
  });


  // ---------- Demo conversations, leads, opportunities (so the UI is alive pre-Meta) ----------
  const integration = await prisma.integration.create({
    data: {
      organizationId: org.id, provider: "INSTAGRAM", externalId: "demo_ig_17841400000000",
      displayName: "@aldiyar.realestate", status: "CONNECTED", lastSyncAt: new Date(),
    },
  });

  const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { order: "asc" } });
  const agentMembers = await prisma.organizationMember.findMany({ where: { organizationId: org.id, role: "AGENT" } });

  const demoLeads = [
    { name: "محمد الربيعي", ig: "m.alrubaie", phone: "+9647701234567", purpose: "BUY", area: "المنصور", budgetMin: 90000, budgetMax: 130000, score: 75, temp: "SALES_READY", stage: 4, msgs: [
      ["CUSTOMER", "سلام، شفت اعلانكم عن مجمع الياسمين. شقد سعر شقة غرفتين؟"],
      ["AI", "أهلاً بك! شقق الغرفتين في مجمع الياسمين تبدأ من 95,000$ بمساحة 120م². تحب أعرفك على تفاصيل أكثر أو خطط الأقساط؟"],
      ["CUSTOMER", "اي بالتقسيط شلون؟ وميزانيتي حدود 120 الف"],
      ["AI", "ممتاز، ميزانيتك تغطي خيارات جيدة. عندنا خطة أقساط 24 شهر بمقدم 30%. تحب نحجزلك موعد زيارة للموقع؟"],
      ["CUSTOMER", "اي خلي يتصل بيه احد من عدكم، رقمي 07701234567"],
    ]},
    { name: "نور الجبوري", ig: "noor.jb", phone: null, purpose: "INVEST", area: null, budgetMin: null, budgetMax: null, score: 30, temp: "COLD", stage: 1, msgs: [
      ["CUSTOMER", "هل عندكم وحدات للاستثمار؟"],
      ["AI", "أهلاً! نعم، مجمع الياسمين فيه وحدات مناسبة للاستثمار. حتى أساعدك أفضل: شنو الميزانية التقريبية والمنطقة المفضلة؟"],
    ]},
    { name: "علياء حسين", ig: "alyaa.h", phone: "+9647809998877", purpose: "BUY", area: "المنصور", budgetMin: 120000, budgetMax: 160000, score: 55, temp: "WARM", stage: 2, msgs: [
      ["CUSTOMER", "اريد شقة 3 غرف بالمنصور"],
      ["AI", "أهلاً بك! متوفرة شقق 3 غرف بمساحة 155م² في مجمع الياسمين بالمنصور، السعر 125,000$. تحب صور وتفاصيل المخطط؟"],
      ["CUSTOMER", "اي دزيلي، وميزانيتي لحد 160"],
    ]},
    { name: null, ig: "spam_acc_99", phone: null, purpose: "UNKNOWN", area: null, budgetMin: null, budgetMax: null, score: 0, temp: "COLD", stage: 9, msgs: [
      ["CUSTOMER", "ربح فوري!! ادخل الرابط 🎁🎁"],
    ]},
  ] as const;

  for (let i = 0; i < demoLeads.length; i++) {
    const d = demoLeads[i];
    const conv = await prisma.conversation.create({
      data: {
        organizationId: org.id, integrationId: integration.id,
        externalThreadId: `demo_thread_${i}`, customerExternalId: `demo_user_${i}`,
        customerUsername: d.ig, customerName: d.name,
        status: i === 3 ? "SPAM" : i === 0 ? "NEEDS_HUMAN" : "AI_ACTIVE",
        lastMessageAt: new Date(Date.now() - i * 3600_000),
      },
    });
    for (let m = 0; m < d.msgs.length; m++) {
      const [sender, text] = d.msgs[m];
      await prisma.message.create({
        data: {
          organizationId: org.id, conversationId: conv.id,
          externalMessageId: `demo_msg_${i}_${m}`,
          direction: sender === "CUSTOMER" ? "INBOUND" : "OUTBOUND",
          senderType: sender as any, body: text,
          createdAt: new Date(Date.now() - i * 3600_000 - (d.msgs.length - m) * 120_000),
        },
      });
    }
    const lead = await prisma.lead.create({
      data: {
        organizationId: org.id, conversationId: conv.id,
        fullName: d.name, igUsername: d.ig, phone: d.phone,
        purpose: d.purpose as any, area: d.area, city: d.area ? "بغداد" : null,
        budgetMin: d.budgetMin, budgetMax: d.budgetMax,
        score: d.score, temperature: d.temp as any,
        interestedProjectId: project.id,
        ownerMemberId: agentMembers[i % agentMembers.length].id,
        lastInteractionAt: new Date(Date.now() - i * 3600_000),
      },
    });
    await prisma.leadIdentifier.create({ data: { leadId: lead.id, kind: "ig_user_id", value: `demo_user_${i}` } });
    await prisma.opportunity.create({
      data: {
        organizationId: org.id, leadId: lead.id, pipelineId: pipeline.id,
        stageId: stages[d.stage].id,
        value: d.budgetMax ?? undefined,
        lostReason: d.stage === 9 ? "Spam" : undefined,
      },
    });
    if (d.score > 0) {
      await prisma.leadScoreEvent.create({
        data: { leadId: lead.id, ruleEvent: "SEED", points: d.score, reason: "بيانات تجريبية", scoreAfter: d.score },
      });
    }
  }

  // Knowledge source + AI runs for the reports
  const ks = await prisma.knowledgeSource.create({
    data: { organizationId: org.id, projectId: project.id, type: "TEXT", title: "دليل مجمع الياسمين", status: "ACTIVE" },
  });
  await prisma.knowledgeDocument.createMany({
    data: [
      { sourceId: ks.id, chunkIndex: 0, content: "مجمع الياسمين السكني يقع في بغداد - المنصور. يضم بناية A بثمانية طوابق. شقق غرفتين 120م² وثلاث غرف 155م². التسليم متوقع نهاية 2027." },
      { sourceId: ks.id, chunkIndex: 1, content: "خطط الدفع: كاش بخصم، أو أقساط 24 شهراً بمقدم 30%. المجمع يشمل مواقف سيارات وحديقة وأمن على مدار الساعة." },
    ],
  });
  for (let i = 0; i < 12; i++) {
    await prisma.aiRun.create({
      data: {
        organizationId: org.id, runType: "RESPONSE",
        confidence: 0.6 + Math.random() * 0.35,
        handedOff: i % 4 === 0, latencyMs: 900 + Math.floor(Math.random() * 1200),
        costUsd: 0.004, createdAt: new Date(Date.now() - i * 7200_000),
      },
    });
  }

  console.log("Seed complete. Login: admin@demo.leadra.ai / Leadra@2026!");
}

main().finally(() => prisma.$disconnect());
