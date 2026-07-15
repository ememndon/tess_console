import type { DemoRecipe } from "./types";
import type { SiteKey } from "@/lib/site-scope";

// Demo recipe registry. Authored, deterministic click-paths for
// flagship site features. The agentic part — deciding what to feature and writing
// the narration — happens elsewhere (scenario.ts); the path itself is fixed code so
// demos never break or invent a result. Locators are resilient (label/role/text),
// so they tolerate minor DOM changes. Adding a feature = adding a recipe here.
//
// Recipes interact only with safe, client-side inputs (no data is submitted/saved
// on the live sites). BMI computes entirely in the browser.

export const RECIPES: DemoRecipe[] = [
  {
    id: "calculatry-bmi",
    site: "calculatry",
    feature: "BMI Calculator",
    url: "https://calculatry.com/bmi-calculator",
    summary:
      "Show how fast and simple it is to find your Body Mass Index on Calculatry — switch to metric, enter weight, height, age and gender, and the result with its health category appears instantly.",
    baseViewport: { width: 1280, height: 900 },
    // Inputs on this page carry no id/label/aria (placeholders are just default
    // values) and gender is a radio group — so we target the VISIBLE number inputs
    // by order in the page's default (imperial) layout: weight, feet, inches, age.
    steps: [
      { id: "open", action: "goto", beat: "Open the Calculatry BMI calculator page.", focus: false, settleMs: 1400 },
      { id: "weight", action: "fill", target: { css: 'input[type="number"]:visible', nth: 0 }, value: "160", beat: "Type in a weight of 160 pounds.", settleMs: 700 },
      { id: "heightft", action: "fill", target: { css: 'input[type="number"]:visible', nth: 1 }, value: "5", beat: "Set the height to 5 feet.", settleMs: 600 },
      { id: "heightin", action: "fill", target: { css: 'input[type="number"]:visible', nth: 2 }, value: "9", beat: "And 9 inches.", settleMs: 700 },
      { id: "age", action: "fill", target: { css: 'input[type="number"]:visible', nth: 3 }, value: "30", beat: "Add an age of 30 years.", settleMs: 700 },
      { id: "gender", action: "click", target: { css: 'input[name="gender"]', nth: 0 }, beat: "Choose a gender.", settleMs: 800 },
      { id: "compute", action: "wait", value: "1500", beat: "The calculator computes the result instantly — no submit button needed.", focus: false, settleMs: 600 },
      { id: "result", action: "reveal", target: { text: "your bmi is", css: "text=/bmi/i" }, beat: "Reveal the resulting BMI value and the weight category it falls into.", settleMs: 1800 },
    ],
  },
  // Multi-page guided tour of GlobalResumeHub: homepage → country list → a country's
  // guide → its free template → the step-by-step builder (filled, live preview). Uses
  // goto transitions (reliable on the 9:16 mobile layout where nav is a hamburger) and
  // placeholder/text locators that resolve in both mobile and desktop layouts.
  {
    id: "globalresumehub-tour-canada",
    site: "resumehub",
    feature: "GlobalResumeHub — Canada guide, template & builder",
    url: "https://globalresumehub.com/",
    summary:
      "A guided tour of GlobalResumeHub: from the homepage to the searchable country list, into Canada's local resume guide, its free ATS-friendly template, and the step-by-step builder filling in real details with a live preview.",
    baseViewport: { width: 1280, height: 900 },
    steps: [
      { id: "home", action: "goto", focus: false, settleMs: 1500, beat: "Open GlobalResumeHub — free resume and CV templates for any country." },
      { id: "hero", action: "reveal", target: { text: "Build the Right Resume" }, settleMs: 1400, beat: "Build the right resume or CV for any of 195 plus countries — free, with no sign up." },
      { id: "browse", action: "goto", value: "https://globalresumehub.com/countries", focus: false, settleMs: 1500, beat: "Browse the full list of countries." },
      { id: "search", action: "fill", target: { css: "#filter-countries", placeholder: "Search countries" }, value: "Canada", settleMs: 1300, beat: "Search for the country you are applying to, like Canada." },
      { id: "canada", action: "goto", value: "https://globalresumehub.com/canada", focus: false, settleMs: 1600, beat: "Open Canada for a full guide to the local resume format." },
      { id: "guide", action: "reveal", target: { text: "How to Write a Canadian Resume" }, settleMs: 1500, beat: "Learn exactly what Canadian employers expect — from length to layout." },
      { id: "download", action: "goto", value: "https://globalresumehub.com/canada/download", focus: false, settleMs: 1700, beat: "Grab a ready made, ATS friendly Canada template — real selectable text, the right format." },
      // /canada/build is a client-only route (404s on a cold load), so reach the builder
      // by CLICKING the page's banner link — the SPA renders the form without a reload.
      { id: "build", action: "click", target: { css: 'a[href$="/canada/build"]' }, focus: false, settleMs: 4200, beat: "Or build your own, step by step." },
      { id: "name", action: "fill", target: { placeholder: "Jane Smith", label: "Full Name" }, value: "Daniel Bennett", settleMs: 700, beat: "Add your name," },
      { id: "title", action: "fill", target: { placeholder: "Software Engineer", label: "Job Title" }, value: "Marketing Manager", settleMs: 700, beat: "your target role," },
      { id: "email", action: "fill", target: { placeholder: "jane@example.com", label: "Email" }, value: "daniel.bennett@email.com", settleMs: 700, beat: "and your contact details." },
      { id: "location", action: "fill", target: { placeholder: "New York, NY", label: "Location" }, value: "Toronto, ON", settleMs: 900, beat: "" },
      { id: "preview", action: "reveal", target: { text: "LIVE PREVIEW" }, settleMs: 2000, beat: "And your resume builds itself in real time as you type." },
    ],
  },
];

export function listRecipes(): DemoRecipe[] {
  return RECIPES;
}

export function recipesForSite(site: SiteKey): DemoRecipe[] {
  return RECIPES.filter((r) => r.site === site);
}

export function getRecipe(id: string): DemoRecipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
