const PAGE_SIZE = 40;
const TOP_LIMIT = 15;
const HISTORICAL_PARTY_IDS = new Set(["pbd", "prd", "pls"]);
const LEGISLATURE_ELECTION_YEARS = [
  1848, 1851, 1854, 1857, 1860, 1863, 1866, 1869, 1872, 1875, 1878, 1881, 1884, 1887, 1890, 1893, 1896, 1899,
  1902, 1905, 1908, 1911, 1914, 1917, 1919, 1922, 1925, 1928, 1931, 1935, 1939, 1943, 1947, 1951, 1955, 1959,
  1963, 1967, 1971, 1975, 1979, 1983, 1987, 1991, 1995, 1999, 2003, 2007, 2011, 2015, 2019, 2023,
];
const LEGISLATURE_DEFINITIONS = LEGISLATURE_ELECTION_YEARS.map((startYear, index, years) => {
  const number = index + 1;
  const nextStartYear =
    years[index + 1] ?? (startYear >= 1931 ? startYear + 4 : startYear + 3);

  return {
    id: `L${String(number).padStart(2, "0")}`,
    number,
    startYear,
    nextStartYear,
    period: `${startYear}-${nextStartYear}`,
  };
});

const state = {
  data: null,
  randomVote: null,
  filteredVotes: [],
  visibleCount: PAGE_SIZE,
  activeTab: "explorer",
  showHistoricalParties: false,
  filters: {
    search: "",
    yearFrom: null,
    yearTo: null,
    result: "all",
    partyId: "all",
    recommendation: "all",
    sortBy: "year-desc",
  },
  statistics: {
    rows: [],
    legislatureMeta: [],
    filters: {
      partyId: "all",
      legislatureId: "all",
    },
  },
};

const els = {
  datasetMeta: document.getElementById("dataset-meta"),
  randomizeVote: document.getElementById("randomize-vote"),
  randomVoteCard: document.getElementById("random-vote-card"),
  tabButtons: [...document.querySelectorAll(".tab-button")],
  viewExplorer: document.getElementById("view-explorer"),
  viewStatistics: document.getElementById("view-statistics"),
  search: document.getElementById("search"),
  yearFrom: document.getElementById("year-from"),
  yearTo: document.getElementById("year-to"),
  resultFilter: document.getElementById("result-filter"),
  partyFilter: document.getElementById("party-filter"),
  recommendationFilter: document.getElementById("recommendation-filter"),
  sortBy: document.getElementById("sort-by"),
  resetFilters: document.getElementById("reset-filters"),
  statTotal: document.getElementById("stat-total"),
  statPeriod: document.getElementById("stat-period"),
  statUpcoming: document.getElementById("stat-upcoming"),
  statYesAverage: document.getElementById("stat-yes-average"),
  partyStats: document.getElementById("party-stats"),
  votesList: document.getElementById("votes-list"),
  resultCount: document.getElementById("result-count"),
  loadMore: document.getElementById("load-more"),
  topAcceptedList: document.getElementById("top-accepted-list"),
  topRejectedList: document.getElementById("top-rejected-list"),
  legislaturePartyFilter: document.getElementById("legislature-party-filter"),
  legislatureFilter: document.getElementById("legislature-filter"),
  legislatureSummary: document.getElementById("legislature-summary"),
  legislatureTableBody: document.getElementById("legislature-table-body"),
  historicalToggles: [...document.querySelectorAll("[data-toggle-historical]")],
};

const recommendationLabels = {
  oui: "Oui",
  non: "Non",
  "liberte de vote": "Liberté de vote",
  neutre: "Neutre",
  "pas de position": "Pas de position",
};

init().catch((error) => {
  console.error(error);
  if (els.votesList) {
    els.votesList.innerHTML = '<p class="result-count">Impossible de charger les données.</p>';
  }
});

async function init() {
  const response = await fetch("data/votes.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load data: ${response.status}`);
  }

  state.data = await response.json();
  pickRandomVote();
  state.statistics.rows = buildLegislatureRows(state.data.votes);
  state.statistics.legislatureMeta = buildLegislatureMeta(state.data.votes);

  setupFilters();
  setupStatisticsFilters();
  updateHistoricalToggleButtons();
  bindEvents();
  setActiveTabFromHash();
  render();
}

function setupFilters() {
  const { fromYear, toYear } = state.data.stats;

  fillYearSelect(els.yearFrom, fromYear, toYear, fromYear);
  fillYearSelect(els.yearTo, fromYear, toYear, toYear);

  state.filters.yearFrom = fromYear;
  state.filters.yearTo = toYear;
  refreshPartyFilterOptions();

  const generated = formatDate(state.data.generatedAt);
  els.datasetMeta.textContent = `Base: ${state.data.stats.objects} objets (${state.data.stats.fromYear}-${state.data.stats.toYear}), mise à jour le ${generated}.`;
}

function setupStatisticsFilters() {
  refreshPartyFilterOptions();

  const legislatureOptions = [
    '<option value="all">Toutes les législatures</option>',
    ...state.statistics.legislatureMeta.map(
      (leg) => `<option value="${leg.id}">${leg.id} (${leg.period})</option>`
    ),
  ];
  els.legislatureFilter.innerHTML = legislatureOptions.join("");
}

function getVisibleParties() {
  if (state.showHistoricalParties) {
    return state.data.parties;
  }
  return state.data.parties.filter((party) => !HISTORICAL_PARTY_IDS.has(party.id));
}

function buildPartyOptions(parties) {
  return [
    '<option value="all">Tous les partis</option>',
    ...parties.map((party) => `<option value="${party.id}">${escapeHtml(party.name)}</option>`),
  ];
}

function normalizeSelectedParty(selectedPartyId, parties) {
  if (selectedPartyId === "all") {
    return "all";
  }
  return parties.some((party) => party.id === selectedPartyId) ? selectedPartyId : "all";
}

function refreshPartyFilterOptions() {
  const parties = getVisibleParties();
  const partyOptions = buildPartyOptions(parties).join("");

  const selectedExplorerParty = normalizeSelectedParty(state.filters.partyId, parties);
  els.partyFilter.innerHTML = partyOptions;
  els.partyFilter.value = selectedExplorerParty;
  state.filters.partyId = selectedExplorerParty;

  const selectedStatsParty = normalizeSelectedParty(state.statistics.filters.partyId, parties);
  els.legislaturePartyFilter.innerHTML = partyOptions;
  els.legislaturePartyFilter.value = selectedStatsParty;
  state.statistics.filters.partyId = selectedStatsParty;
}

function updateHistoricalToggleButtons() {
  const label = state.showHistoricalParties ? "Masquer les partis historiques" : "Afficher les partis historiques";
  for (const button of els.historicalToggles) {
    button.textContent = label;
    button.setAttribute("aria-pressed", state.showHistoricalParties ? "true" : "false");
  }
}

function bindEvents() {
  els.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab, true);
    });
  });

  window.addEventListener("hashchange", () => {
    setActiveTabFromHash();
  });

  els.search.addEventListener("input", () => {
    state.filters.search = els.search.value.trim().toLowerCase();
    resetVisible();
    renderExplorer();
  });

  els.yearFrom.addEventListener("change", () => {
    state.filters.yearFrom = Number(els.yearFrom.value);
    if (state.filters.yearFrom > state.filters.yearTo) {
      state.filters.yearTo = state.filters.yearFrom;
      els.yearTo.value = String(state.filters.yearTo);
    }
    resetVisible();
    renderExplorer();
  });

  els.yearTo.addEventListener("change", () => {
    state.filters.yearTo = Number(els.yearTo.value);
    if (state.filters.yearTo < state.filters.yearFrom) {
      state.filters.yearFrom = state.filters.yearTo;
      els.yearFrom.value = String(state.filters.yearFrom);
    }
    resetVisible();
    renderExplorer();
  });

  els.resultFilter.addEventListener("change", () => {
    state.filters.result = els.resultFilter.value;
    resetVisible();
    renderExplorer();
  });

  els.partyFilter.addEventListener("change", () => {
    state.filters.partyId = els.partyFilter.value;
    resetVisible();
    renderExplorer();
  });

  els.recommendationFilter.addEventListener("change", () => {
    state.filters.recommendation = els.recommendationFilter.value;
    resetVisible();
    renderExplorer();
  });

  els.sortBy.addEventListener("change", () => {
    state.filters.sortBy = els.sortBy.value;
    renderExplorer();
  });

  els.resetFilters.addEventListener("click", () => {
    const { fromYear, toYear } = state.data.stats;

    state.filters = {
      search: "",
      yearFrom: fromYear,
      yearTo: toYear,
      result: "all",
      partyId: "all",
      recommendation: "all",
      sortBy: "year-desc",
    };

    els.search.value = "";
    els.yearFrom.value = String(fromYear);
    els.yearTo.value = String(toYear);
    els.resultFilter.value = "all";
    els.partyFilter.value = "all";
    els.recommendationFilter.value = "all";
    els.sortBy.value = "year-desc";

    resetVisible();
    renderExplorer();
  });

  els.loadMore.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderVotes();
  });

  els.legislaturePartyFilter.addEventListener("change", () => {
    state.statistics.filters.partyId = els.legislaturePartyFilter.value;
    renderLegislatureTable();
  });

  els.legislatureFilter.addEventListener("change", () => {
    state.statistics.filters.legislatureId = els.legislatureFilter.value;
    renderLegislatureTable();
  });

  els.historicalToggles.forEach((button) => {
    button.addEventListener("click", () => {
      state.showHistoricalParties = !state.showHistoricalParties;
      refreshPartyFilterOptions();
      updateHistoricalToggleButtons();
      resetVisible();
      render();
    });
  });

  els.randomizeVote.addEventListener("click", () => {
    pickRandomVote();
  });
}

function setActiveTabFromHash() {
  const hash = window.location.hash.replace("#", "");
  if (hash === "statistics") {
    setActiveTab("statistics", false);
    return;
  }
  setActiveTab("explorer", false);
}

function setActiveTab(tab, syncHash) {
  state.activeTab = tab === "statistics" ? "statistics" : "explorer";

  els.tabButtons.forEach((button) => {
    const active = button.dataset.tab === state.activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  els.viewExplorer.classList.toggle("hidden", state.activeTab !== "explorer");
  els.viewStatistics.classList.toggle("hidden", state.activeTab !== "statistics");

  if (syncHash) {
    const nextHash = state.activeTab === "statistics" ? "#statistics" : "#explorer";
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }
}

function render() {
  renderExplorer();
  renderStatistics();
}

function renderExplorer() {
  const filtered = applyFilters(state.data.votes, state.filters);
  state.filteredVotes = sortVotes(filtered, state.filters.sortBy);

  renderStats();
  renderPartyStats();
  renderVotes();
}

function renderStatistics() {
  renderTopRankings();
  renderLegislatureTable();
}

function pickRandomVote() {
  const withResult = state.data.votes.filter((vote) => vote.result !== null);
  const pool = withResult.length ? withResult : state.data.votes;
  const randomIndex = Math.floor(Math.random() * pool.length);
  state.randomVote = pool[randomIndex] ?? null;
  renderRandomVote();
}

function renderRandomVote() {
  if (!state.randomVote) {
    els.randomVoteCard.innerHTML = '<p class="result-count">Aucun objet disponible.</p>';
    return;
  }

  const vote = state.randomVote;
  const recs = sortRecommendations(vote.recommendations, "all");
  const chips = recs.length
    ? recs
        .map((rec) => {
          const label = recommendationLabels[rec.recommendation] ?? rec.recommendation ?? "Sans position";
          const chipClass = `chip-${classNameFromRecommendation(rec.recommendation)}`;
          return `<span class="chip ${chipClass}"><strong>${escapeHtml(rec.party)}</strong>${escapeHtml(label)}</span>`;
        })
        .join("")
    : '<span class="chip chip-empty">Aucune recommandation disponible</span>';

  const yes = typeof vote.yesPercent === "number" ? vote.yesPercent : null;
  const no = typeof vote.noPercent === "number" ? vote.noPercent : null;
  const hasPercent = yes !== null && no !== null;
  const yesWidth = hasPercent ? clamp(yes, 0, 100) : 0;
  const noWidth = hasPercent ? clamp(no, 0, 100) : 0;
  const resultLabel = vote.result === "oui" ? "Accepté" : vote.result === "non" ? "Refusé" : "À venir";
  const resultClass = vote.result ? `result-${vote.result}` : "result-upcoming";
  const voteTitle = vote.url
    ? `<a href="${escapeHtml(vote.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(vote.object)}</a>`
    : escapeHtml(vote.object);

  els.randomVoteCard.innerHTML = `
    <div class="vote-top">
      <span class="year-badge">${vote.year}</span>
      <span class="result-pill ${resultClass}">${resultLabel}</span>
    </div>
    <h3 class="vote-title">${voteTitle}</h3>
    ${
      hasPercent
        ? `
          <div class="percent-row">
            <span>Oui: ${yes.toFixed(2)} %</span>
            <span>Non: ${no.toFixed(2)} %</span>
          </div>
          <div class="result-track">
            <span class="result-yes" style="width: ${yesWidth}%"></span>
            <span class="result-no" style="width: ${noWidth}%"></span>
          </div>
        `
        : '<p class="percent-row">Résultat officiel non disponible</p>'
    }
    <div class="chips">${chips}</div>
  `;
}

function applyFilters(votes, filters) {
  return votes.filter((vote) => {
    if (vote.year < filters.yearFrom || vote.year > filters.yearTo) {
      return false;
    }

    if (filters.search && !vote.object.toLowerCase().includes(filters.search)) {
      return false;
    }

    if (filters.result !== "all") {
      if (filters.result === "upcoming" && vote.result !== null) {
        return false;
      }
      if ((filters.result === "oui" || filters.result === "non") && vote.result !== filters.result) {
        return false;
      }
    }

    if (filters.partyId !== "all") {
      const rec = vote.recommendations.find((item) => item.partyId === filters.partyId);
      if (!rec) {
        return false;
      }
      if (filters.recommendation !== "all" && rec.recommendation !== filters.recommendation) {
        return false;
      }
    } else if (filters.recommendation !== "all") {
      const hasRecommendation = vote.recommendations.some((rec) => rec.recommendation === filters.recommendation);
      if (!hasRecommendation) {
        return false;
      }
    }

    return true;
  });
}

function sortVotes(votes, sortBy) {
  const sorted = [...votes];

  if (sortBy === "year-asc") {
    sorted.sort((a, b) => a.year - b.year || a.object.localeCompare(b.object, "fr"));
    return sorted;
  }

  if (sortBy === "yes-desc") {
    sorted.sort((a, b) => (b.yesPercent ?? -1) - (a.yesPercent ?? -1) || b.year - a.year);
    return sorted;
  }

  if (sortBy === "no-desc") {
    sorted.sort((a, b) => (b.noPercent ?? -1) - (a.noPercent ?? -1) || b.year - a.year);
    return sorted;
  }

  sorted.sort((a, b) => b.year - a.year || a.object.localeCompare(b.object, "fr"));
  return sorted;
}

function renderStats() {
  const votes = state.filteredVotes;
  const total = votes.length;
  const upcoming = votes.filter((vote) => vote.result === null).length;

  const years = votes.map((vote) => vote.year);
  const fromYear = years.length ? Math.min(...years) : "-";
  const toYear = years.length ? Math.max(...years) : "-";

  const yesValues = votes.map((vote) => vote.yesPercent).filter((value) => typeof value === "number");
  const avgYes = yesValues.length
    ? `${(yesValues.reduce((acc, value) => acc + value, 0) / yesValues.length).toFixed(1)} %`
    : "-";

  els.statTotal.textContent = String(total);
  els.statPeriod.textContent = years.length ? `${fromYear}-${toYear}` : "-";
  els.statUpcoming.textContent = String(upcoming);
  els.statYesAverage.textContent = avgYes;
}

function renderPartyStats() {
  const stats = new Map();

  for (const party of state.data.parties) {
    stats.set(party.id, {
      partyId: party.id,
      party: party.name,
      recommendations: 0,
      oui: 0,
      non: 0,
      wins: 0,
      losses: 0,
    });
  }

  for (const vote of state.filteredVotes) {
    for (const rec of vote.recommendations) {
      const partyStats = stats.get(rec.partyId);
      if (!partyStats) {
        continue;
      }

      if (rec.recommendation) {
        partyStats.recommendations += 1;
      }
      if (rec.recommendation === "oui") {
        partyStats.oui += 1;
      }
      if (rec.recommendation === "non") {
        partyStats.non += 1;
      }
      if (rec.won === true) {
        partyStats.wins += 1;
      }
      if (rec.won === false) {
        partyStats.losses += 1;
      }
    }
  }

  const html = [...stats.values()]
    .filter((row) => state.showHistoricalParties || !HISTORICAL_PARTY_IDS.has(row.partyId))
    .sort((a, b) => a.party.localeCompare(b.party, "fr"))
    .map((row) => {
      const totalOutcomes = row.wins + row.losses;
      const align = totalOutcomes > 0 ? ((row.wins / totalOutcomes) * 100).toFixed(1) : null;
      const barWidth = align ? Number(align) : 0;
      const isHistorical = HISTORICAL_PARTY_IDS.has(row.partyId);
      const historicalClass = isHistorical ? " party-row-historical" : "";
      const historicalLabel = isHistorical ? '<span class="historical-label">historique</span>' : "";

      return `
        <article class="party-row${historicalClass}">
          <header>
            <h3>${escapeHtml(row.party)}${historicalLabel}</h3>
            <span>${align ? `${align} %` : "n/a"}</span>
          </header>
          <div class="bar"><span style="width: ${barWidth}%"></span></div>
          <p>Recommandations: ${row.recommendations} | Oui: ${row.oui} | Non: ${row.non}</p>
        </article>
      `;
    })
    .join("");

  els.partyStats.innerHTML = html;
}

function renderVotes() {
  const total = state.filteredVotes.length;
  const visible = state.filteredVotes.slice(0, state.visibleCount);

  els.resultCount.textContent = `${visible.length} affichés sur ${total}`;

  if (!visible.length) {
    els.votesList.innerHTML = '<p class="result-count">Aucun objet ne correspond aux filtres sélectionnés.</p>';
    els.loadMore.style.display = "none";
    return;
  }

  const selectedPartyId = state.filters.partyId;

  const cards = visible.map((vote) => {
    const recs = sortRecommendations(vote.recommendations, selectedPartyId);
    const chips = recs.length
      ? recs
          .map((rec) => {
            const label = recommendationLabels[rec.recommendation] ?? rec.recommendation ?? "Sans position";
            const chipClass = `chip-${classNameFromRecommendation(rec.recommendation)}`;
            const highlight = selectedPartyId !== "all" && rec.partyId === selectedPartyId ? " chip-highlight" : "";
            return `<span class="chip ${chipClass}${highlight}"><strong>${escapeHtml(rec.party)}</strong>${escapeHtml(label)}</span>`;
          })
          .join("")
      : '<span class="chip chip-empty">Aucune recommandation disponible</span>';

    const yes = typeof vote.yesPercent === "number" ? vote.yesPercent : null;
    const no = typeof vote.noPercent === "number" ? vote.noPercent : null;
    const hasPercent = yes !== null && no !== null;

    const resultLabel = vote.result === "oui" ? "Accepté" : vote.result === "non" ? "Refusé" : "À venir";
    const resultClass = vote.result ? `result-${vote.result}` : "result-upcoming";
    const voteTitle = vote.url
      ? `<a href="${escapeHtml(vote.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(vote.object)}</a>`
      : escapeHtml(vote.object);

    const yesWidth = hasPercent ? clamp(yes, 0, 100) : 0;
    const noWidth = hasPercent ? clamp(no, 0, 100) : 0;

    return `
      <article class="vote-card">
        <div class="vote-top">
          <span class="year-badge">${vote.year}</span>
          <span class="result-pill ${resultClass}">${resultLabel}</span>
        </div>
        <h3 class="vote-title">${voteTitle}</h3>
        ${
          hasPercent
            ? `
              <div class="percent-row">
                <span>Oui: ${yes.toFixed(2)} %</span>
                <span>Non: ${no.toFixed(2)} %</span>
              </div>
              <div class="result-track">
                <span class="result-yes" style="width: ${yesWidth}%"></span>
                <span class="result-no" style="width: ${noWidth}%"></span>
              </div>
            `
            : '<p class="percent-row">Résultat officiel non disponible</p>'
        }
        <div class="chips">${chips}</div>
      </article>
    `;
  });

  els.votesList.innerHTML = cards.join("");
  els.loadMore.style.display = state.visibleCount < total ? "inline-flex" : "none";
}

function renderTopRankings() {
  const accepted = state.data.votes
    .filter((vote) => vote.result === "oui" && typeof vote.yesPercent === "number")
    .sort((a, b) => b.yesPercent - a.yesPercent || b.year - a.year)
    .slice(0, TOP_LIMIT);

  const rejected = state.data.votes
    .filter((vote) => vote.result === "non" && typeof vote.noPercent === "number")
    .sort((a, b) => b.noPercent - a.noPercent || b.year - a.year)
    .slice(0, TOP_LIMIT);

  els.topAcceptedList.innerHTML = renderRankingList(accepted, "yesPercent", "accepted");
  els.topRejectedList.innerHTML = renderRankingList(rejected, "noPercent", "rejected");
}

function renderRankingList(items, percentField, tone) {
  if (!items.length) {
    return '<li class="ranking-empty">Aucune donnée disponible</li>';
  }

  return items
    .map((vote, index) => {
      const percent = vote[percentField];
      const objectLabel = vote.url
        ? `<a href="${escapeHtml(vote.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(vote.object)}</a>`
        : escapeHtml(vote.object);
      return `
        <li>
          <p class="rank-line">
            <span class="rank-index">${index + 1}.</span>
            <span class="rank-percent rank-${tone}">${percent.toFixed(2)} %</span>
            <span class="rank-year">${vote.year}</span>
          </p>
          <p class="rank-object">${objectLabel}</p>
        </li>
      `;
    })
    .join("");
}

function renderLegislatureTable() {
  const partyId = state.statistics.filters.partyId;
  const legislatureId = state.statistics.filters.legislatureId;

  const filteredRows = state.statistics.rows.filter((row) => {
    if (!state.showHistoricalParties && HISTORICAL_PARTY_IDS.has(row.partyId)) {
      return false;
    }
    if (partyId !== "all" && row.partyId !== partyId) {
      return false;
    }
    if (legislatureId !== "all" && row.legislatureId !== legislatureId) {
      return false;
    }
    return true;
  });

  if (!filteredRows.length) {
    els.legislatureSummary.textContent = "0 ligne";
    els.legislatureTableBody.innerHTML =
      '<tr><td colspan="10" class="table-empty">Aucun résultat pour ce filtre.</td></tr>';
    return;
  }

  els.legislatureSummary.textContent = `${filteredRows.length} ligne(s) affichée(s)`;

  els.legislatureTableBody.innerHTML = filteredRows
    .map((row) => {
      const alignment = row.alignmentRate === null ? "-" : `${row.alignmentRate.toFixed(1)} %`;
      return `
        <tr>
          <td>${row.legislatureId}</td>
          <td>${row.period}</td>
          <td>${escapeHtml(row.party)}</td>
          <td>${row.recommendations}</td>
          <td>${row.oui}</td>
          <td>${row.non}</td>
          <td>${row.other}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${alignment}</td>
        </tr>
      `;
    })
    .join("");
}

function sortRecommendations(recommendations, selectedPartyId) {
  return [...recommendations].sort((a, b) => {
    if (selectedPartyId !== "all") {
      if (a.partyId === selectedPartyId) {
        return -1;
      }
      if (b.partyId === selectedPartyId) {
        return 1;
      }
    }
    return a.party.localeCompare(b.party, "fr");
  });
}

function buildLegislatureRows(votes) {
  const partyNames = new Map(state.data.parties.map((party) => [party.id, party.name]));
  const rowsByKey = new Map();

  for (const vote of votes) {
    const legislature = getLegislatureForYear(vote.year);

    for (const rec of vote.recommendations) {
      // PLR exists as a merged party from 2009 onward.
      // Before 2009, statistics should reflect PRD/PLS instead.
      if (rec.partyId === "plr" && vote.year < 2009) {
        continue;
      }

      if (!rec.recommendation && rec.won === null) {
        continue;
      }

      const key = `${legislature.id}|${rec.partyId}`;
      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, {
          legislatureId: legislature.id,
          legislatureNumber: legislature.number,
          period: legislature.period,
          partyId: rec.partyId,
          party: partyNames.get(rec.partyId) ?? rec.party,
          recommendations: 0,
          oui: 0,
          non: 0,
          other: 0,
          wins: 0,
          losses: 0,
          alignmentRate: null,
        });
      }

      const row = rowsByKey.get(key);

      if (rec.recommendation) {
        row.recommendations += 1;
        if (rec.recommendation === "oui") {
          row.oui += 1;
        } else if (rec.recommendation === "non") {
          row.non += 1;
        } else {
          row.other += 1;
        }
      }

      if (rec.won === true) {
        row.wins += 1;
      }
      if (rec.won === false) {
        row.losses += 1;
      }
    }
  }

  const rows = [...rowsByKey.values()];
  for (const row of rows) {
    const totalOutcomes = row.wins + row.losses;
    if (totalOutcomes > 0) {
      row.alignmentRate = (row.wins / totalOutcomes) * 100;
    }
  }

  rows.sort((a, b) => {
    if (a.legislatureNumber !== b.legislatureNumber) {
      return b.legislatureNumber - a.legislatureNumber;
    }
    return a.party.localeCompare(b.party, "fr");
  });

  return rows;
}

function buildLegislatureMeta(votes) {
  const years = votes.map((vote) => vote.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  return LEGISLATURE_DEFINITIONS.filter(
    (leg) => leg.startYear <= maxYear && leg.nextStartYear >= minYear
  ).sort((a, b) => b.number - a.number);
}

function getLegislatureForYear(year) {
  let selected = LEGISLATURE_DEFINITIONS[0];
  for (const legislature of LEGISLATURE_DEFINITIONS) {
    if (legislature.startYear <= year) {
      selected = legislature;
    } else {
      break;
    }
  }
  return selected;
}

function classNameFromRecommendation(recommendation) {
  if (!recommendation) {
    return "empty";
  }
  return recommendation
    .toLowerCase()
    .replaceAll(" ", "-")
    .replaceAll("é", "e")
    .replaceAll("è", "e")
    .replaceAll("à", "a");
}

function fillYearSelect(selectEl, from, to, selected) {
  const options = [];
  for (let year = from; year <= to; year += 1) {
    options.push(`<option value="${year}" ${year === selected ? "selected" : ""}>${year}</option>`);
  }
  selectEl.innerHTML = options.join("");
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  return date.toLocaleDateString("fr-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resetVisible() {
  state.visibleCount = PAGE_SIZE;
}
