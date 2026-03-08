const PAGE_SIZE = 40;

const state = {
  data: null,
  filteredVotes: [],
  visibleCount: PAGE_SIZE,
  filters: {
    search: "",
    yearFrom: null,
    yearTo: null,
    result: "all",
    partyId: "all",
    recommendation: "all",
    sortBy: "year-desc",
  },
};

const els = {
  datasetMeta: document.getElementById("dataset-meta"),
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
  els.votesList.innerHTML = '<p class="result-count">Impossible de charger les données.</p>';
});

async function init() {
  const response = await fetch("data/votes.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load data: ${response.status}`);
  }

  state.data = await response.json();

  setupFilters();
  bindEvents();
  render();
}

function setupFilters() {
  const { fromYear, toYear } = state.data.stats;

  fillYearSelect(els.yearFrom, fromYear, toYear, fromYear);
  fillYearSelect(els.yearTo, fromYear, toYear, toYear);

  state.filters.yearFrom = fromYear;
  state.filters.yearTo = toYear;

  const partyOptions = [
    '<option value="all">Tous les partis</option>',
    ...state.data.parties.map((party) => `<option value="${party.id}">${escapeHtml(party.name)}</option>`),
  ];
  els.partyFilter.innerHTML = partyOptions.join("");

  const generated = formatDate(state.data.generatedAt);
  els.datasetMeta.textContent = `Base: ${state.data.stats.objects} objets (${state.data.stats.fromYear}-${state.data.stats.toYear}), mise à jour le ${generated}.`;
}

function bindEvents() {
  els.search.addEventListener("input", () => {
    state.filters.search = els.search.value.trim().toLowerCase();
    resetVisible();
    render();
  });

  els.yearFrom.addEventListener("change", () => {
    state.filters.yearFrom = Number(els.yearFrom.value);
    if (state.filters.yearFrom > state.filters.yearTo) {
      state.filters.yearTo = state.filters.yearFrom;
      els.yearTo.value = String(state.filters.yearTo);
    }
    resetVisible();
    render();
  });

  els.yearTo.addEventListener("change", () => {
    state.filters.yearTo = Number(els.yearTo.value);
    if (state.filters.yearTo < state.filters.yearFrom) {
      state.filters.yearFrom = state.filters.yearTo;
      els.yearFrom.value = String(state.filters.yearFrom);
    }
    resetVisible();
    render();
  });

  els.resultFilter.addEventListener("change", () => {
    state.filters.result = els.resultFilter.value;
    resetVisible();
    render();
  });

  els.partyFilter.addEventListener("change", () => {
    state.filters.partyId = els.partyFilter.value;
    resetVisible();
    render();
  });

  els.recommendationFilter.addEventListener("change", () => {
    state.filters.recommendation = els.recommendationFilter.value;
    resetVisible();
    render();
  });

  els.sortBy.addEventListener("change", () => {
    state.filters.sortBy = els.sortBy.value;
    render();
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
    render();
  });

  els.loadMore.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderVotes();
  });
}

function render() {
  const filtered = applyFilters(state.data.votes, state.filters);
  state.filteredVotes = sortVotes(filtered, state.filters.sortBy);

  renderStats();
  renderPartyStats();
  renderVotes();
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
    .sort((a, b) => a.party.localeCompare(b.party, "fr"))
    .map((row) => {
      const totalOutcomes = row.wins + row.losses;
      const align = totalOutcomes > 0 ? ((row.wins / totalOutcomes) * 100).toFixed(1) : null;
      const barWidth = align ? Number(align) : 0;

      return `
        <article class="party-row">
          <header>
            <h3>${escapeHtml(row.party)}</h3>
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

    const yesWidth = hasPercent ? clamp(yes, 0, 100) : 0;
    const noWidth = hasPercent ? clamp(no, 0, 100) : 0;

    return `
      <article class="vote-card">
        <div class="vote-top">
          <span class="year-badge">${vote.year}</span>
          <span class="result-pill ${resultClass}">${resultLabel}</span>
        </div>
        <h3 class="vote-title">${escapeHtml(vote.object)}</h3>
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
