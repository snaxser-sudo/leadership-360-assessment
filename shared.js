(function () {
  const storageKey = "leadership360-anonymous-evaluations-v1";
  const config = window.L360_SUPABASE || {};

  const managers = Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    name: `Топ-менеджер ${index + 1}`,
    code: `TM${index + 1}`
  }));

  const competencies = [
    { id: 1, title: "Принятие решений", short: "Решения", summary: "Выбор курса действий в неопределенности и ответственность за последствия." },
    { id: 2, title: "Стратегическое мышление", short: "Стратегия", summary: "Видение рынка, долгосрочных рисков и точек роста за пределами операционки." },
    { id: 3, title: "Управление людьми", short: "Люди", summary: "Постановка целей, развитие лидеров, обратная связь и результативность команды." },
    { id: 4, title: "Финансовая грамотность", short: "Финансы", summary: "Понимание экономики решений, P&L, маржинальности, cash flow и окупаемости." },
    { id: 5, title: "Коммуникация и влияние", short: "Влияние", summary: "Ясное объяснение позиции, договоренности и проведение решений через группы." },
    { id: 6, title: "Управление изменениями", short: "Изменения", summary: "Проведение трансформаций от причины изменений до внедрения и закрепления." },
    { id: 7, title: "Клиент и рынок", short: "Клиент", summary: "Ориентация на клиента, конкурентную среду и реальную ценность продукта." },
    { id: 8, title: "Операционная дисциплина", short: "Операции", summary: "Перевод целей в процессы, метрики, регулярный контроль и предсказуемый результат." },
    { id: 9, title: "Лидерская зрелость", short: "Зрелость", summary: "Саморегуляция, этика, устойчивость под давлением и доверие команды." }
  ];

  let client = null;
  let remoteReady = false;
  let remoteAvailable = false;
  let evaluationsCache = loadLocalEvaluations();

  function isRemoteConfigured() {
    return Boolean(config.url && config.anonKey && window.supabase);
  }

  function getMode() {
    return remoteReady ? "supabase" : "local";
  }

  function getClient() {
    if (!client && isRemoteConfigured()) {
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
    return client;
  }

  async function init(options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) {
      remoteReady = false;
      remoteAvailable = false;
      evaluationsCache = loadLocalEvaluations();
      return { mode: "local" };
    }

    remoteAvailable = true;
    remoteReady = true;
    if (options.load !== false) {
      try {
        await refreshEvaluations();
      } catch {
        evaluationsCache = [];
      }
    }
    return { mode: "supabase" };
  }

  function loadLocalEvaluations() {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveLocalEvaluations(evaluations) {
    localStorage.setItem(storageKey, JSON.stringify(evaluations));
  }

  function loadEvaluations() {
    return evaluationsCache;
  }

  async function refreshEvaluations() {
    const supabaseClient = getClient();
    if (!supabaseClient) {
      evaluationsCache = loadLocalEvaluations();
      return evaluationsCache;
    }

    const { data, error } = await supabaseClient
      .from("evaluations")
      .select("id, manager_id, comment, created_at, evaluation_scores(competency_id, score)")
      .order("created_at", { ascending: false });

    if (error) throw error;

    evaluationsCache = (data || []).map((row) => {
      const scores = competencies.map(() => 0);
      (row.evaluation_scores || []).forEach((scoreRow) => {
        scores[scoreRow.competency_id - 1] = Number(scoreRow.score);
      });
      return {
        id: row.id,
        managerIndex: Number(row.manager_id) - 1,
        scores,
        comment: row.comment || "",
        createdAt: row.created_at
      };
    });

    return evaluationsCache;
  }

  async function addEvaluation(managerIndex, scores, comment) {
    const safeComment = String(comment || "").trim().slice(0, 800);
    const localEntry = {
      managerIndex,
      scores,
      comment: safeComment,
      createdAt: new Date().toISOString()
    };

    const supabaseClient = getClient();
    if (!supabaseClient) {
      evaluationsCache = [...evaluationsCache, localEntry];
      saveLocalEvaluations(evaluationsCache);
      return localEntry;
    }

    const { data, error } = await supabaseClient.rpc("submit_evaluation", {
      p_manager_id: managerIndex + 1,
      p_scores: scores,
      p_comment: safeComment || null
    });

    if (error) throw error;

    localEntry.id = data;
    evaluationsCache = [...evaluationsCache, localEntry];
    return localEntry;
  }

  async function clearLocalEvaluations() {
    evaluationsCache = [];
    saveLocalEvaluations([]);
  }

  async function signIn(email, password) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error("Supabase не настроен.");
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return getProfile();
  }

  async function signOut() {
    const supabaseClient = getClient();
    if (supabaseClient) await supabaseClient.auth.signOut();
  }

  async function getProfile() {
    const supabaseClient = getClient();
    if (!supabaseClient) return null;
    const { data: authData, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !authData.user) return null;
    const { data, error } = await supabaseClient
      .from("l360_profiles")
      .select("user_id, role, manager_id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  function getManagerEvaluations(managerIndex, evaluations = evaluationsCache) {
    return evaluations.filter((item) => item.managerIndex === managerIndex);
  }

  function getManagerSummary(managerIndex, evaluations = evaluationsCache) {
    const items = getManagerEvaluations(managerIndex, evaluations);
    if (items.length === 0) {
      return { count: 0, commentsCount: 0, averages: competencies.map(() => null), totalAverage: null };
    }

    const totals = competencies.map(() => 0);
    items.forEach((item) => {
      item.scores.forEach((score, index) => {
        totals[index] += score;
      });
    });

    const averages = totals.map((total) => total / items.length);
    const totalAverage = averages.reduce((sum, value) => sum + value, 0) / averages.length;
    const commentsCount = items.filter((item) => item.comment).length;
    return { count: items.length, commentsCount, averages, totalAverage };
  }

  function getAllSummaries(evaluations = evaluationsCache) {
    return managers.map((_, index) => getManagerSummary(index, evaluations));
  }

  function getPortfolioSummary(evaluations = evaluationsCache) {
    const summaries = getAllSummaries(evaluations);
    const rated = summaries.filter((summary) => summary.count > 0);
    const totalEvaluations = evaluations.length;
    const totalComments = evaluations.filter((item) => item.comment).length;
    const totalAverage =
      rated.length === 0
        ? null
        : rated.reduce((sum, summary) => sum + summary.totalAverage, 0) / rated.length;

    const competencyAverages = competencies.map((_, index) => {
      const values = rated
        .map((summary) => summary.averages[index])
        .filter((value) => value !== null);
      if (values.length === 0) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    });

    return { totalEvaluations, totalComments, totalAverage, competencyAverages };
  }

  function formatScore(value) {
    return value === null ? "—" : value.toFixed(1);
  }

  function scoreClass(value) {
    if (value === null) return "is-empty";
    if (value < 2.5) return "is-low";
    if (value >= 4) return "is-high";
    return "";
  }

  function getPlural(count, forms) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function csvValue(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function summaryCsv(evaluations = evaluationsCache) {
    const rows = [
      ["Топ-менеджер", ...competencies.map((item) => item.short), "Итого", "Количество оценок", "Комментарии"],
      ...managers.map((manager, index) => {
        const summary = getManagerSummary(index, evaluations);
        return [
          manager.name,
          ...summary.averages.map(formatScore),
          formatScore(summary.totalAverage),
          summary.count,
          summary.commentsCount
        ];
      })
    ];
    return rows.map((row) => row.map(csvValue).join(";")).join("\n");
  }

  function drawRadar(canvas, values, options = {}) {
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const center = size / 2;
    const maxRadius = size * 0.34;
    const sides = competencies.length;
    const safeValues = values.map((value) => (value === null ? 0 : value));

    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = 1;

    for (let ring = 1; ring <= 5; ring += 1) {
      ctx.beginPath();
      for (let i = 0; i < sides; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / sides;
        const radius = (maxRadius / 5) * ring;
        const x = center + Math.cos(angle) * radius;
        const y = center + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = ring === 5 ? "#cfc6b8" : "#e6ded2";
      ctx.stroke();
    }

    competencies.forEach((item, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides;
      const x = center + Math.cos(angle) * maxRadius;
      const y = center + Math.sin(angle) * maxRadius;
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.lineTo(x, y);
      ctx.strokeStyle = "#e6ded2";
      ctx.stroke();

      const labelRadius = maxRadius + 40;
      const labelX = center + Math.cos(angle) * labelRadius;
      const labelY = center + Math.sin(angle) * labelRadius;
      ctx.fillStyle = options.labelColor || "#5c6773";
      ctx.font = "700 14px Inter, system-ui, sans-serif";
      ctx.textAlign = Math.cos(angle) > 0.25 ? "left" : Math.cos(angle) < -0.25 ? "right" : "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), labelX, labelY);
    });

    ctx.beginPath();
    safeValues.forEach((value, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides;
      const radius = (maxRadius / 5) * value;
      const x = center + Math.cos(angle) * radius;
      const y = center + Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = options.fill || "rgba(29, 127, 122, 0.2)";
    ctx.strokeStyle = options.stroke || "#1d7f7a";
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();

    safeValues.forEach((value, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides;
      const radius = (maxRadius / 5) * value;
      const x = center + Math.cos(angle) * radius;
      const y = center + Math.sin(angle) * radius;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = options.dot || "#c38a2f";
      ctx.fill();
    });
  }

  window.L360 = {
    storageKey,
    managers,
    competencies,
    isRemoteConfigured,
    getMode,
    init,
    refreshEvaluations,
    loadEvaluations,
    addEvaluation,
    clearLocalEvaluations,
    signIn,
    signOut,
    getProfile,
    getManagerEvaluations,
    getManagerSummary,
    getAllSummaries,
    getPortfolioSummary,
    formatScore,
    scoreClass,
    getPlural,
    escapeHtml,
    csvValue,
    downloadBlob,
    summaryCsv,
    drawRadar
  };
})();
