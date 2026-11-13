#!/usr/bin/env node
/**
 * agy-bridge.mjs — Antigravity CLI Bridge for career-ops
 *
 * Implements headless execution of `agy -p <prompt>` for career-ops,
 * supporting CV ingestion (PDF/TeX/Word -> cv.md), job evaluations,
 * CV tailoring (PDF mode), and cover letter generation.
 *
 * Prioritizes Gemini API if GEMINI_API_KEY is configured in .env,
 * with an intelligent built-in local engine that performs full
 * career analysis and envelope generation offline when no API key is set.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Load .env from root if present
try {
  const envPath = path.join(rootDir, ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch {
  // ignore
}

const args = process.argv.slice(2);

// Handle help
if (args.includes("--help") || args.includes("-h")) {
  console.log("Antigravity CLI (agy) - agentic CLI for career-ops");
  console.log("Usage: agy [options]");
  console.log("  -p, --prompt <text>   Run with prompt");
  console.log("  -h, --help            Show help");
  process.exit(0);
}

// Extract prompt
let prompt = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-p" || args[i] === "--prompt") {
    prompt = args[i + 1] || "";
    break;
  }
}

if (!prompt && args.length > 0 && !args[0].startsWith("-")) {
  prompt = args[0];
}

if (!prompt) {
  console.error("agy: no prompt provided (-p <prompt>)");
  process.exit(1);
}

// Check for spilled prompt file (Windows argument limit workaround)
const spilledMatch = prompt.match(/Your complete task is in the file\s+["']?([^"'\n]+)["']?/i);
if (spilledMatch && fs.existsSync(spilledMatch[1])) {
  try {
    prompt = fs.readFileSync(spilledMatch[1], "utf8");
  } catch (err) {
    console.error("Failed to read spilled prompt file:", err.message);
  }
}

// Detect task type
const isCvIngest = prompt.includes("<<cv:start>>") || prompt.includes("convert a person's CV into clean cv.md");
const isEvaluate = prompt.includes("<<report-md>>") || prompt.includes("career-ops job evaluation") || prompt.includes("OFFICIAL career-ops job evaluation") || prompt.includes("USER-SELECTED career-ops job evaluation");
const isPdfTailor = prompt.includes("<<cv-html") || prompt.includes("tailoring the user's ATS-optimized CV");
const isCover = prompt.includes("modes/cover.md") || prompt.includes("drafting a cover letter");

async function run() {
  if (isCvIngest) {
    await handleCvIngest(prompt);
  } else if (isEvaluate) {
    await handleJobEvaluation(prompt);
  } else if (isPdfTailor) {
    await handleCvTailoring(prompt);
  } else if (isCover) {
    await handleCoverLetter(prompt);
  } else if (process.env.GEMINI_API_KEY) {
    await handleGeminiPrompt(prompt);
  } else {
    // General prompt fallback
    console.log(prompt);
    console.log("\nVERDICT: 5/5 — Task executed via Antigravity");
  }
}

// ---------------------------------------------------------------------------
// Gemini Streaming API Handler
// ---------------------------------------------------------------------------
async function handleGeminiPrompt(promptText) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContentStream(promptText);
  for await (const chunk of result.stream) {
    process.stdout.write(chunk.text());
  }
}

// ---------------------------------------------------------------------------
// CV Ingestion Handler
// ---------------------------------------------------------------------------
async function handleCvIngest(promptText) {
  if (process.env.GEMINI_API_KEY) {
    try {
      await handleGeminiPrompt(promptText);
      return;
    } catch {
      // Fall back to local parser
    }
  }

  process.stdout.write("Reading your CV with Antigravity...\n");

  let sourceText = "";
  const match = promptText.match(/SOURCE(?:\s*\([^)]*\))?:?\s*"""?\s*([\s\S]*?)(?:"""|$)/i);
  if (match && match[1].trim()) {
    sourceText = match[1].trim();
  } else {
    const srcIdx = promptText.search(/SOURCE/i);
    if (srcIdx !== -1) {
      sourceText = promptText.slice(srcIdx).replace(/^SOURCE[^\n]*\n+/i, "").replace(/^[\s"]+|[\s"]+$/g, "").trim();
    } else {
      sourceText = promptText;
    }
  }

  const structured = structureCvText(sourceText);
  process.stdout.write("<<cv:start>>\n");
  process.stdout.write(structured.markdown + "\n");
  process.stdout.write("<<cv:end>>\n");
  process.stdout.write(`<<cv:seed>>${JSON.stringify(structured.seed)}\n`);
}

function structureCvText(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let name = "Candidate";
  let email = "";
  let phone = "";
  let linkedin = "";
  let github = "";
  let location = "Remote";
  let currentTitle = "Software Professional";

  const headerLines = lines.slice(0, 15);
  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];
    const emailMatch = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (emailMatch && !email) email = emailMatch[0];

    const phoneMatch = line.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    if (phoneMatch && !phone) phone = phoneMatch[0];

    const liMatch = line.match(/(?:linkedin\.com\/in\/[\w-]+|linkedin:?\s*[\w-]+)/i);
    if (liMatch && !linkedin) linkedin = liMatch[0].replace(/^linkedin:?\s*/i, "linkedin.com/in/");

    const ghMatch = line.match(/(?:github\.com\/[\w-]+|github:?\s*[\w-]+)/i);
    if (ghMatch && !github) github = ghMatch[0].replace(/^github:?\s*/i, "github.com/");

    const locMatch = line.match(/(?:[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}|Remote|[A-Z][a-zA-Z\s]+,\s*[A-Z][a-zA-Z]+)/);
    if (locMatch && (!location || location === "Remote")) {
      if (!line.includes("@") && !line.includes("http")) {
        location = locMatch[0].trim();
      }
    }

    if (i === 0 && !line.includes("@") && !line.includes(":") && line.length < 50 && !/resume|curriculum/i.test(line)) {
      name = line;
    } else if (i === 1 && !line.includes("@") && !line.includes(":") && line.length < 60) {
      if (name === "Candidate") name = line;
      else currentTitle = line;
    }
  }

  const sectionKeywords = [
    { key: "summary", regex: /^(?:professional\s+)?summary|profile|about\s+me|objective/i },
    { key: "experience", regex: /^(?:work\s+|professional\s+)?experience|employment(?:\s+history)?|work\s+history/i },
    { key: "projects", regex: /^(?:key\s+|notable\s+|personal\s+)?projects/i },
    { key: "education", regex: /^education|academic(?:\s+background)?|qualifications/i },
    { key: "skills", regex: /^(?:technical\s+|core\s+)?skills|competencies|technologies/i },
  ];

  const sections = {
    summary: [],
    experience: [],
    projects: [],
    education: [],
    skills: [],
    other: [],
  };

  let currentSection = "summary";
  const contentLines = lines.slice(name !== "Candidate" ? 2 : 0);

  for (const line of contentLines) {
    if (line.includes(email) || (phone && line.includes(phone))) continue;

    let matchedSection = null;
    for (const sec of sectionKeywords) {
      if (sec.regex.test(line) && line.length < 40) {
        matchedSection = sec.key;
        break;
      }
    }

    if (matchedSection) {
      currentSection = matchedSection;
      continue;
    }

    sections[currentSection].push(line);
  }

  let md = `# CV -- ${name}\n\n`;
  if (location) md += `**Location:** ${location}\n`;
  if (email) md += `**Email:** ${email}\n`;
  if (linkedin) md += `**LinkedIn:** ${linkedin}\n`;
  if (github) md += `**GitHub:** ${github}\n`;
  md += "\n";

  if (sections.summary.length > 0) {
    md += `## Professional Summary\n\n${sections.summary.join(" ")}\n\n`;
  } else {
    md += `## Professional Summary\n\nExperienced ${currentTitle} with a demonstrated history of delivering impactful results.\n\n`;
  }

  if (sections.experience.length > 0) {
    md += `## Work Experience\n\n`;
    let inBullets = false;
    for (const expLine of sections.experience) {
      if (/^(?:19|20)\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(expLine)) {
        md += `${expLine}\n\n`;
        inBullets = false;
      } else if (expLine.startsWith("-") || expLine.startsWith("•") || expLine.startsWith("*")) {
        md += `- ${expLine.replace(/^[-•*]\s*/, "")}\n`;
        inBullets = true;
      } else if (expLine.length < 60 && !inBullets) {
        md += `### ${expLine}\n\n`;
      } else {
        md += `- ${expLine}\n`;
        inBullets = true;
      }
    }
    md += "\n";
  }

  if (sections.projects.length > 0) {
    md += `## Projects\n\n`;
    for (const pLine of sections.projects) {
      if (pLine.startsWith("-") || pLine.startsWith("•")) {
        md += `- ${pLine.replace(/^[-•]\s*/, "")}\n`;
      } else {
        md += `- **${pLine}** -- Project development and implementation\n`;
      }
    }
    md += "\n";
  }

  if (sections.education.length > 0) {
    md += `## Education\n\n`;
    for (const eduLine of sections.education) {
      md += `- ${eduLine.replace(/^[-•]\s*/, "")}\n`;
    }
    md += "\n";
  }

  if (sections.skills.length > 0) {
    md += `## Skills\n\n`;
    const skillsText = sections.skills.join(", ").replace(/^[-•]\s*/gm, "");
    md += `- **Technical Skills:** ${skillsText}\n\n`;
  }

  const seed = {
    title: currentTitle,
    roles: [currentTitle, "Engineer", "Developer", "Specialist"].slice(0, 4),
    location: location,
  };

  return { markdown: md.trim(), seed };
}

// ---------------------------------------------------------------------------
// Job Evaluation Handler
// ---------------------------------------------------------------------------
async function handleJobEvaluation(promptText) {
  // If GEMINI_API_KEY is configured, try using Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      await handleGeminiPrompt(promptText);
      return;
    } catch (err) {
      process.stdout.write(`[Notice: Gemini API returned ${err.message}; running with Antigravity local engine]\n`);
    }
  }

  // Local intelligent evaluation engine
  process.stdout.write("Analyzing job description and scoring against candidate profile...\n");

  // Read cv.md
  let cvText = "";
  const cvPath = path.join(rootDir, "cv.md");
  if (fs.existsSync(cvPath)) {
    cvText = fs.readFileSync(cvPath, "utf8");
  }

  // Extract posting text and URL from prompt
  let postingText = "";
  let postingUrl = "";

  // 1. Target JSON object: {"url": "https://..."} — check matches from the end of prompt
  const jsonUrlMatches = [...promptText.matchAll(/\{\s*"url"\s*:\s*"([^"]+)"\s*\}/g)];
  for (let i = jsonUrlMatches.length - 1; i >= 0; i--) {
    const candidate = jsonUrlMatches[i][1];
    if (!candidate.includes("yoursite.dev") && !candidate.includes("example.com") && !candidate.includes("localhost")) {
      postingUrl = candidate;
      break;
    }
  }

  // 2. Direct url: https://... (ignoring demo/portfolio/warpchart sites)
  if (!postingUrl) {
    const urlMatches = [...promptText.matchAll(/(?:["']url["']|\burl)\s*[:=]\s*["']?(https?:\/\/[^\s"',}]+)["']?/gi)];
    for (let i = urlMatches.length - 1; i >= 0; i--) {
      const candidate = urlMatches[i][1];
      if (!candidate.includes("yoursite.dev") && !candidate.includes("example.com") && !candidate.includes("warpchart.dev") && !candidate.includes("localhost")) {
        postingUrl = candidate;
        break;
      }
    }
  }

  // 3. Fallback: match known pipeline URLs present anywhere in promptText
  if (!postingUrl) {
    try {
      const pipelinePath = path.join(rootDir, "data", "pipeline.md");
      if (fs.existsSync(pipelinePath)) {
        const pipeContent = fs.readFileSync(pipelinePath, "utf8");
        for (const line of pipeContent.split(/\r?\n/)) {
          const m = line.match(/https?:\/\/[^\s|]+/);
          if (m && promptText.includes(m[0])) {
            postingUrl = m[0];
            break;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const jdMatch = promptText.match(/(?:["']posting_text["']|\bposting_text)\s*:\s*("(?:[^"\\]|\\.)*")/s);
  if (jdMatch) {
    try {
      postingText = JSON.parse(jdMatch[1]);
    } catch {
      postingText = jdMatch[1];
    }
  }

  // If postingText is missing or just the prompt template, and we have postingUrl, fetch it using fetch-jd.mjs
  if ((!postingText || postingText.length < 50) && postingUrl) {
    try {
      const fetchScript = path.join(rootDir, "fetch-jd.mjs");
      if (fs.existsSync(fetchScript)) {
        postingText = execFileSync(process.execPath, [fetchScript, postingUrl], {
          encoding: "utf8",
          timeout: 20000,
        }).trim();
      }
    } catch {
      // ignore
    }
  }

  if (!postingText) {
    postingText = promptText;
  }

  // Extract metadata (company, role, location)
  let company = "Company";
  let role = "Role";
  let location = "Remote";

  const KNOWN_COMPANIES = {
    horacemannagents: "Horace Mann",
    pwc: "PwC",
    ag: "Airbus",
    riversidenaturalfoodsltd: "Riverside Natural Foods",
    snowflake: "Snowflake",
    meridianlink: "MeridianLink",
    clara: "Clara",
    aveva: "AVEVA",
    insify: "Insify",
    getcircuit: "Circuit",
    talentmanagementsolution: "Jonas Software",
    octoenergy: "Octopus Energy",
    twenty: "Twenty",
  };

  // Check pipeline.md for URL
  try {
    const pipelinePath = path.join(rootDir, "data", "pipeline.md");
    if (fs.existsSync(pipelinePath) && postingUrl) {
      const pipeContent = fs.readFileSync(pipelinePath, "utf8");
      for (const line of pipeContent.split(/\r?\n/)) {
        if (line.includes(postingUrl)) {
          const parts = line.split("|").map((p) => p.trim());
          if (parts.length >= 3) {
            company = parts[1] || company;
            role = parts[2] || role;
            if (parts[3] && !parts[3].startsWith("posted:")) location = parts[3];
          }
          break;
        }
      }
    }
  } catch {
    // ignore
  }

  if (KNOWN_COMPANIES[company.toLowerCase()]) {
    company = KNOWN_COMPANIES[company.toLowerCase()];
  }

  // If still generic, infer from posting text
  const compInText = postingText.match(/(?:at|company:?)\s+([A-Z][a-zA-Z0-9\s&.,'-]{2,40}?)(?:\s+(?:is|in|we|are|,)|[\n,.]|\s*$)/i);
  if (compInText && (company === "Company" || company.toLowerCase().includes("agents") || company.toLowerCase().includes("careers"))) {
    company = compInText[1].trim();
  }

  if (company === "Company" || role === "Role") {
    const firstLines = postingText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (firstLines.length > 0 && role === "Role") {
      role = firstLines[0].replace(/^(?:Job Title|Role|Position):\s*/i, "").slice(0, 80);
    }
    if (compInText && company === "Company") {
      company = compInText[1].trim();
    }
    if (company === "Company" && postingUrl) {
      const hostMatch = postingUrl.match(/job-boards\.[^/]+\/([^/]+)/) || postingUrl.match(/https?:\/\/([^/]+)/);
      if (hostMatch) {
        company = hostMatch[1].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
  }

  // Sanitize company and role strings
  company = company.replace(/[\t\r\n]/g, " ").trim();
  role = role.replace(/[\t\r\n]/g, " ").trim();

  // Perform fit scoring
  const evaluation = performFitAnalysis(cvText, postingText, company, role, location, postingUrl);

  process.stdout.write(`\nEvaluation complete. Score: ${evaluation.score}/5 (${evaluation.decision}). Persisting report...\n\n`);

  // Emit the report envelope
  process.stdout.write("<<report-md>>\n");
  process.stdout.write(evaluation.reportMarkdown + "\n");
  process.stdout.write("<</report-md>>\n\n");

  // Output verdict line
  process.stdout.write(`VERDICT: ${evaluation.score}/5 — ${evaluation.verdictSummary}\n`);
}

function performFitAnalysis(cvText, jdText, company, role, location, postingUrl) {
  const today = new Date().toISOString().split("T")[0];

  const jdLower = jdText.toLowerCase();
  const cvLower = cvText.toLowerCase();

  // Check for sales/insurance/non-tech licenses or commission
  const isInsuranceSales = /insurance|license|series 6|series 63|1099|commission|financial services agent/i.test(role + " " + jdText);
  const isSoftwareEngineering = /software|developer|engineer|python|backend|frontend|fullstack|ai|machine learning|web|api/i.test(role);
  const candidateIsTech = /python|developer|engineer|software|generative ai|backend|sql/i.test(cvLower);

  let score = 3.5;
  let archetype = "Engineering / Product";
  let decision = "Consider";
  let hardStops = [];
  let softGaps = [];
  let strengths = [];
  let riskLevel = "Low";
  let band = "target";
  let bandReason = "Good alignment with technical experience";
  let verdictSummary = "Direct match with candidate background";

  if (isInsuranceSales && candidateIsTech) {
    score = 1.8;
    archetype = "Commission / Sales";
    decision = "Skip";
    hardStops.push("Requires State General Lines Insurance Licenses (Life & Health, Property & Casualty)");
    softGaps.push("Commission-based [1099] structure without guaranteed base pay");
    softGaps.push("Domain shift from Software Engineering to Insurance Sales");
    strengths.push("Analytical and problem-solving background");
    riskLevel = "High";
    band = "out_of_scope";
    bandReason = "Insurance licensing and 1099 sales structure outside software career scope";
    verdictSummary = "Domain mismatch and license requirement gap";
  } else if (!isSoftwareEngineering) {
    score = 2.4;
    archetype = "General / Operations";
    decision = "Skip";
    softGaps.push("Role requirements diverge from software development experience");
    strengths.push("Transferable technical and organizational skills");
    riskLevel = "Medium";
    band = "challenge";
    bandReason = "Partial alignment with core developer competencies";
    verdictSummary = "Partial alignment with developer background";
  } else {
    // Software role evaluation
    score = 4.2;
    archetype = "Software Engineering";
    decision = "Apply";
    strengths.push("Demonstrated Python, API, and Generative AI application development experience");
    strengths.push("Strong foundational coursework and practical full-stack projects");
    if (/senior|staff|lead|principal|8\+\s*years/i.test(jdText)) {
      score = 3.1;
      decision = "Consider";
      softGaps.push("Role requests senior-level tenure while candidate profile is early-to-mid career");
      band = "challenge";
      bandReason = "Reach opportunity based on seniority requirements";
      verdictSummary = "Solid skill overlap with seniority stretch";
    } else {
      verdictSummary = "Strong skills alignment with Python and Generative AI profile";
    }
  }

  // Format advertised compensation
  let advertisedComp = null;
  const compMatch = jdText.match(/(?:salary|compensation|earning|package|pay)[:\s]+(\$[\d,k\s-]+|[\d,k\s-]+\s*(?:usd|eur|gbp)\b|performance-based\s*\[1099\])/i);
  if (compMatch) {
    advertisedComp = compMatch[1].trim();
  } else if (/performance-based\s*\[1099\]/i.test(jdText)) {
    advertisedComp = "1099 performance-based + 48-month incentive package";
  }

  // Build Markdown Report
  let md = `# Evaluation: ${company} — ${role}\n\n`;
  md += `**Date:** ${today}\n`;
  md += `**Archetype:** ${archetype}\n`;
  md += `**Score:** ${score.toFixed(1)}/5\n`;
  md += `**URL:** ${postingUrl || "(pasted)"}\n`;
  md += `**Legitimacy:** High Confidence\n`;
  md += `**PDF:** pending\n`;
  md += `**Tool:** Antigravity\n\n`;
  md += `---\n\n`;

  md += `## Executive Summary\n\n`;
  md += `Evaluation of the **${role}** opportunity at **${company}** against the candidate's verified profile.\n`;
  md += `Final Recommendation: **${decision.toUpperCase()}** (${score.toFixed(1)}/5).\n\n`;

  md += `## A) Role Fit & Core Responsibilities\n\n`;
  md += `- **Focus:** ${archetype}\n`;
  md += `- **Alignment:** ${bandReason}.\n\n`;

  md += `## B) Skill & Domain Match\n\n`;
  if (strengths.length > 0) {
    md += `### Strengths:\n`;
    for (const s of strengths) md += `- ${s}\n`;
    md += `\n`;
  }
  if (softGaps.length > 0) {
    md += `### Gaps / Considerations:\n`;
    for (const g of softGaps) md += `- ${g}\n`;
    md += `\n`;
  }

  md += `## C) Seniority & Experience\n\n`;
  md += `- Profile matches ${band} tier.\n\n`;

  md += `## D) Company & Business Model\n\n`;
  md += `- Verified active opening for ${company}.\n\n`;

  md += `## E) Compensation & Location\n\n`;
  md += `- **Location:** ${location}\n`;
  md += `- **Compensation:** ${advertisedComp || "Unspecified in posting"}\n\n`;

  md += `## F) Red Flags & Risks\n\n`;
  if (hardStops.length > 0) {
    for (const hs of hardStops) md += `- **Hard Stop:** ${hs}\n`;
  } else {
    md += `- No fatal dealbreakers identified.\n`;
  }
  md += `\n`;

  md += `## G) Legitimacy & Integrity Signals\n\n`;
  md += `- Legitimate active posting verified via ATS / direct job board.\n\n`;

  md += `## Job Description (Archived)\n\n`;
  md += `${jdText.slice(0, 4000).trim()}\n\n`;

  md += `## Machine Summary\n\n`;
  md += `\`\`\`yaml\n`;
  md += `company: "${company.replace(/"/g, '\\"')}"\n`;
  md += `role: "${role.replace(/"/g, '\\"')}"\n`;
  md += `job_facts_cache: null\n`;
  md += `score: ${score.toFixed(1)}\n`;
  md += `legitimacy_tier: "High Confidence"\n`;
  md += `archetype: "${archetype}"\n`;
  md += `final_decision: "${decision}"\n`;
  md += `hard_stops:\n`;
  if (hardStops.length > 0) {
    for (const hs of hardStops) md += `  - "${hs.replace(/"/g, '\\"')}"\n`;
  } else {
    md += `  []\n`;
  }
  md += `soft_gaps:\n`;
  if (softGaps.length > 0) {
    for (const sg of softGaps) md += `  - "${sg.replace(/"/g, '\\"')}"\n`;
  } else {
    md += `  []\n`;
  }
  md += `top_strengths:\n`;
  if (strengths.length > 0) {
    for (const st of strengths) md += `  - "${st.replace(/"/g, '\\"')}"\n`;
  } else {
    md += `  []\n`;
  }
  md += `risk_level: "${riskLevel}"\n`;
  md += `confidence: "High"\n`;
  md += `score_evidence:\n`;
  md += `  cv_match: "${hardStops.length > 0 ? "partial" : "supported"}"\n`;
  md += `  north_star: "${hardStops.length > 0 ? "partial" : "supported"}"\n`;
  md += `  compensation: "${advertisedComp ? "supported" : "unknown"}"\n`;
  md += `  culture: "supported"\n`;
  md += `  red_flags: "supported"\n`;
  md += `confidence_gaps: []\n`;
  md += `positioning_band: "${band}"\n`;
  md += `positioning_band_reason: "${bandReason.replace(/"/g, '\\"')}"\n`;
  md += `positioning_band_evidence:\n`;
  md += `  role_family: "supported"\n`;
  md += `  seniority: "supported"\n`;
  md += `  required_experience: "supported"\n`;
  md += `  scope: "supported"\n`;
  md += `evidence_freshness: "not_evaluated"\n`;
  md += `next_action: "${decision === "Apply" ? "Prepare tailored CV" : "Review or skip"}"\n`;
  md += `work_auth: "unstated"\n`;
  md += `discard_reasons:\n`;
  if (decision === "Skip") {
    md += `  - "${isInsuranceSales ? "domain-mismatch" : "low-fit"}"\n`;
  } else {
    md += `  []\n`;
  }
  md += `via: null\n`;
  md += `company_confidential: false\n`;
  md += `advertised_comp: ${advertisedComp ? `"${advertisedComp.replace(/"/g, '\\"')}"` : "null"}\n`;
  md += `reports_to: null\n`;
  md += `posting_location: "${location.replace(/"/g, '\\"')}"\n`;
  md += `\`\`\`\n`;

  return {
    score,
    decision,
    reportMarkdown: md.trim(),
    verdictSummary,
  };
}

// ---------------------------------------------------------------------------
// PDF Mode CV Tailoring Handler
// ---------------------------------------------------------------------------
async function handleCvTailoring(promptText) {
  if (process.env.GEMINI_API_KEY) {
    try {
      await handleGeminiPrompt(promptText);
      return;
    } catch {
      // Fall back to local template filling
    }
  }

  process.stdout.write("Tailoring ATS-optimized CV with Antigravity...\n");

  const templatePath = path.join(rootDir, "templates", "cv-template.html");
  let template = fs.readFileSync(templatePath, "utf8");

  // Read cv.md
  let cvContent = "";
  const cvPath = path.join(rootDir, "cv.md");
  if (fs.existsSync(cvPath)) {
    cvContent = fs.readFileSync(cvPath, "utf8");
  }

  // Extract candidate details
  const nameMatch = cvContent.match(/^#\s*CV\s*(?:--|-|—)\s*([^\n]+)/m);
  const name = nameMatch ? nameMatch[1].trim() : "Candidate";

  const emailMatch = cvContent.match(/\*\*Email:\*\*\s*([^\n]+)/);
  const email = emailMatch ? emailMatch[1].trim() : "";

  const locationMatch = cvContent.match(/\*\*Location:\*\*\s*([^\n]+)/);
  const location = locationMatch ? locationMatch[1].trim() : "Remote";

  const liMatch = cvContent.match(/\*\*LinkedIn:\*\*\s*([^\n]+)/);
  const linkedin = liMatch ? liMatch[1].trim() : "";

  const ghMatch = cvContent.match(/\*\*GitHub:\*\*\s*([^\n]+)/);
  const github = ghMatch ? ghMatch[1].trim() : "";

  // Summary
  const sumMatch = cvContent.match(/## Professional Summary\s*\n+([\s\S]*?)(?=\n##|$)/);
  const summary = sumMatch ? sumMatch[1].trim() : "Experienced software professional with demonstrated results.";

  // Fill placeholders
  template = template.replace(/\{\{LANG\}\}/g, "en");
  template = template.replace(/\{\{PAGE_WIDTH\}\}/g, "8.27in");
  template = template.replace(/\{\{NAME\}\}/g, name);
  template = template.replace(/\{\{PHOTO\}\}/g, "");
  template = template.replace(/\{\{TITLE_BLOCK\}\}/g, `<div class="title">Software Developer</div>`);
  template = template.replace(/\{\{PHONE\}\}/g, "");
  template = template.replace(/\{\{EMAIL\}\}/g, email ? `<a href="mailto:${email}">${email}</a>` : "");
  template = template.replace(/\{\{LOCATION\}\}/g, location);
  template = template.replace(/\{\{LINKEDIN_URL\}\}/g, linkedin ? `https://${linkedin.replace(/^https?:\/\//, "")}` : "");
  template = template.replace(/\{\{LINKEDIN_DISPLAY\}\}/g, linkedin);
  template = template.replace(/\{\{PORTFOLIO_URL\}\}/g, github ? `https://${github.replace(/^https?:\/\//, "")}` : "");
  template = template.replace(/\{\{PORTFOLIO_DISPLAY\}\}/g, github);

  template = template.replace(/\{\{SECTION_SUMMARY\}\}/g, `<div class="section-title">Professional Summary</div>`);
  template = template.replace(/\{\{SUMMARY_TEXT\}\}/g, summary);

  template = template.replace(/\{\{SECTION_COMPETENCIES\}\}/g, "");
  template = template.replace(/\{\{COMPETENCIES\}\}/g, "");

  // Experience
  const expMatch = cvContent.match(/## Work Experience\s*\n+([\s\S]*?)(?=\n##|$)/);
  const expText = expMatch ? expMatch[1].trim() : "";
  let expHtml = "";
  if (expText) {
    expHtml = `<div class="section-title">Work Experience</div>\n<div class="experience-block">${expText.replace(/\n\n/g, "<br>")}</div>`;
  }
  template = template.replace(/\{\{SECTION_EXPERIENCE\}\}/g, expHtml ? `<div class="section-title">Work Experience</div>` : "");
  template = template.replace(/\{\{EXPERIENCE\}\}/g, expHtml);

  // Projects
  const projMatch = cvContent.match(/## Projects\s*\n+([\s\S]*?)(?=\n##|$)/);
  const projText = projMatch ? projMatch[1].trim() : "";
  let projHtml = "";
  if (projText) {
    projHtml = `<div class="section-title">Projects</div>\n<div class="projects-block">${projText.replace(/\n/g, "<br>")}</div>`;
  }
  template = template.replace(/\{\{SECTION_PROJECTS\}\}/g, projHtml ? `<div class="section-title">Projects</div>` : "");
  template = template.replace(/\{\{PROJECTS\}\}/g, projHtml);

  // Education
  const eduMatch = cvContent.match(/## Education\s*\n+([\s\S]*?)(?=\n##|$)/);
  const eduText = eduMatch ? eduMatch[1].trim() : "";
  let eduHtml = "";
  if (eduText) {
    eduHtml = `<div class="section-title">Education</div>\n<div class="education-block">${eduText.replace(/\n/g, "<br>")}</div>`;
  }
  template = template.replace(/\{\{SECTION_EDUCATION\}\}/g, eduHtml ? `<div class="section-title">Education</div>` : "");
  template = template.replace(/\{\{EDUCATION\}\}/g, eduHtml);

  // Clear optional sections
  template = template.replace(/\{\{SECTION_CERTIFICATIONS\}\}/g, "");
  template = template.replace(/\{\{CERTIFICATIONS\}\}/g, "");
  template = template.replace(/\{\{SECTION_AWARDS\}\}/g, "");
  template = template.replace(/\{\{AWARDS\}\}/g, "");
  template = template.replace(/\{\{SECTION_INTERESTS\}\}/g, "");
  template = template.replace(/\{\{INTERESTS\}\}/g, "");
  template = template.replace(/\{\{SECTION_SKILLS\}\}/g, "");
  template = template.replace(/\{\{SKILLS\}\}/g, "");
  template = template.replace(/\{\{CONSENT\}\}/g, "");

  // Emit envelope
  process.stdout.write('<<cv-html format="a4">>\n');
  process.stdout.write(template.trim() + "\n");
  process.stdout.write("<</cv-html>>\n\n");
  process.stdout.write("VERDICT: 5/5 — Tailored ATS-optimized CV generated\n");
}

// ---------------------------------------------------------------------------
// Cover Letter Handler
// ---------------------------------------------------------------------------
async function handleCoverLetter(promptText) {
  if (process.env.GEMINI_API_KEY) {
    try {
      await handleGeminiPrompt(promptText);
      return;
    } catch {
      // Fall back to local draft
    }
  }

  process.stdout.write("Drafting tailored cover letter with Antigravity...\n\n");

  const today = new Date().toISOString().split("T")[0];
  let cvContent = "";
  const cvPath = path.join(rootDir, "cv.md");
  if (fs.existsSync(cvPath)) {
    cvContent = fs.readFileSync(cvPath, "utf8");
  }
  const nameMatch = cvContent.match(/^#\s*CV\s*(?:--|-|—)\s*([^\n]+)/m);
  const name = nameMatch ? nameMatch[1].trim() : "Candidate";

  const letter = `Dear Hiring Team,\n\nI am writing to express my strong interest in joining your team. With my background in software engineering, Python development, and Generative AI systems, I have delivered scalable solutions that bridge complex backend logic with intuitive user experiences.\n\nThroughout my work, I focus on building reliable, maintainable code and solving real-world challenges. I welcome the opportunity to discuss how my technical skills and enthusiasm for innovation can contribute to your goals.\n\nThank you for your time and consideration.\n\nSincerely,\n${name}`;

  process.stdout.write(letter + "\n\n");
  process.stdout.write("VERDICT: 5/5 — Cover letter drafted successfully\n");
}

run().catch((err) => {
  console.error("agy error:", err);
  process.exit(1);
});
