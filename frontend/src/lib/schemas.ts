/** Zod schemas mirroring the FastAPI responses (backend/app/api/serializers.py and friends). */
import { z } from "zod";

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();
const record = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------- auth
export const TokenOut = z.object({
  access_token: z.string(),
  token_type: z.string(),
  user: z.object({ id: z.string(), email: z.string() }),
});
export const Me = z.object({
  id: z.string(),
  email: z.string(),
  has_profile: z.boolean(),
  candidate_id: str,
});
export type Me = z.infer<typeof Me>;

// ---------------------------------------------------------------- tasks
export const Task = z.object({
  id: z.string(),
  event_type: z.string(),
  status: z.string(),
  attempts: z.number(),
  result: record.nullable().optional(),
  error: str,
  created_at: str,
  updated_at: str,
});
export type Task = z.infer<typeof Task>;
export const TaskDetail = Task.extend({ children: z.array(Task).default([]) });
export const TaskList = z.object({ tasks: z.array(Task) });
export const TaskEnvelope = z.object({ task: Task }).passthrough();

// ---------------------------------------------------------------- resume versions
export const Version = z.object({
  id: z.string(),
  version_number: z.number(),
  version_type: z.string(),
  label: str,
  job_id: str,
  parent_version_id: str,
  template: z.string(),
  status: z.string(),
  quality_index: num,
  parser_score: num,
  keyword_score: num,
  requirement_score: num,
  evidence_score: num,
  round_trip_score: num,
  formatting_score: num,
  created_at: str,
  approved_at: str,
  has_docx: z.boolean(),
  has_pdf: z.boolean(),
  has_original: z.boolean(),
  last_job_id: str,
});
export type Version = z.infer<typeof Version>;
export const VersionList = z.object({
  versions: z.array(Version.extend({ job_title: str, company: str })),
});

// ---------------------------------------------------------------- profile
export const Contact = z.object({
  name: str,
  email: str,
  phone: str,
  location: str,
  linkedin: str,
  github: str,
  portfolio: str,
  other_links: z.array(z.string()).default([]),
});
export const Skill = z.object({
  name: z.string(),
  category: z.string().default("other"),
  sections: z.array(z.string()).default([]),
  known: z.boolean().default(true),
});
export const Experience = z.object({
  id: z.string(),
  company: str,
  title: str,
  location: str,
  start_date: str,
  end_date: str,
  current: z.boolean().default(false),
  is_internship: z.boolean().default(false),
  bullets: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  raw_header: str,
});
export const Education = z.object({
  id: z.string(),
  institution: str,
  degree: str,
  degree_level: str,
  field: str,
  start_date: str,
  end_date: str,
  grade: str,
  raw: str,
});
export const Project = z.object({
  id: z.string(),
  name: z.string(),
  description: str,
  url: str,
  start_date: str,
  end_date: str,
  bullets: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
});
export const Certification = z.object({ id: z.string(), name: z.string(), issuer: str, date: str });
export const Profile = z.object({
  contact: Contact,
  summary: str,
  skills: z.array(Skill).default([]),
  experience: z.array(Experience).default([]),
  education: z.array(Education).default([]),
  projects: z.array(Project).default([]),
  certifications: z.array(Certification).default([]),
  achievements: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  sections_found: z.array(z.string()).default([]),
  total_experience_months: z.number().default(0),
  internship_months: z.number().default(0),
  job_titles: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  target_roles: z.array(z.string()).default([]),
  soft_skills: z.array(z.string()).default([]),
});
export type Profile = z.infer<typeof Profile>;
export const ProfileOut = z.object({ candidate_id: z.string(), profile: Profile, warnings: z.array(z.string()).default([]) });
export const ProfileUpdateOut = z.object({
  profile: Profile,
  master_version_id: z.string(),
  regression: record.nullable().optional(),
});

export const ResumeOut = z.object({
  candidate_id: z.string(),
  master_version: Version.nullable(),
  file: z
    .object({
      id: z.string(),
      filename: z.string(),
      type: z.string(),
      size: z.number(),
      uploaded_at: str,
      layout: record.nullable().optional(),
    })
    .nullable(),
  profile: Profile.nullable(),
  warnings: z.array(z.string()).default([]),
  raw_text_preview: z.string().default(""),
});
export const UploadOut = z.object({
  candidate_id: z.string(),
  resume_version_id: z.string(),
  resume_file_id: z.string(),
  warnings: z.array(z.string()).default([]),
  skills: z.number(),
  experience_entries: z.number(),
  target_roles: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------- preferences
export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship", "temporary"] as const;
export const EXPERIENCE_LEVELS = ["intern", "entry", "mid", "senior", "lead"] as const;
export const APPLICATION_MODES = ["DISCOVERY_ONLY", "ASSISTED_APPLICATION", "AUTHORIZED_AUTO_APPLY"] as const;
export const SEARCH_FREQUENCIES = ["off", "hourly", "every_6_hours", "daily"] as const;
export const APPROVAL_CATEGORIES = ["SALARY", "VISA", "WORK_AUTHORIZATION", "DEMOGRAPHIC", "CUSTOM"] as const;

export const Preferences = z.object({
  target_titles: z.array(z.string()),
  locations: z.array(z.string()),
  work_modes: z.array(z.enum(WORK_MODES)),
  minimum_salary: z.number().nonnegative().nullable(),
  currency: z.string().min(3).max(3),
  experience_level: z.enum(EXPERIENCE_LEVELS).nullable(),
  employment_types: z.array(z.enum(EMPLOYMENT_TYPES)),
  visa_sponsorship_required: z.boolean().nullable(),
  work_authorization_countries: z.array(z.string()),
  search_keywords: z.array(z.string()),
  excluded_companies: z.array(z.string()),
  search_frequency: z.enum(SEARCH_FREQUENCIES),
  minimum_match_score: z.number().min(0).max(100),
  application_mode: z.enum(APPLICATION_MODES),
  auto_apply: z.boolean(),
  auto_apply_minimum_score: z.number().min(0).max(100),
  daily_application_limit: z.number().int().min(0).max(50),
  require_user_approval_for: z.array(z.string()),
  notify_email: z.boolean(),
  notify_in_app: z.boolean(),
});
export type Preferences = z.infer<typeof Preferences>;

// ---------------------------------------------------------------- jobs & matches
export const Component = z.object({
  score: z.number(),
  weight: z.number(),
  reason: z.string().default(""),
});
export const Match = z.object({
  id: z.string(),
  job_id: z.string(),
  overall_score: z.number(),
  skill_score: num,
  role_score: num,
  experience_score: num,
  location_score: num,
  education_score: num,
  preference_score: num,
  seniority_score: num,
  semantic_similarity: num,
  hard_filter_passed: z.boolean(),
  hard_filter_reasons: z.array(z.string()).default([]),
  matched_skills: z.array(z.string()).default([]),
  missing_skills: z.record(z.string(), z.array(z.string())).default({}),
  breakdown: z.record(z.string(), Component.passthrough()).default({}),
  explanation: str,
  explanation_source: str,
  resume_compatibility: num,
  saved: z.boolean(),
  dismissed: z.boolean(),
  created_at: str,
  updated_at: str,
});
export type Match = z.infer<typeof Match>;

export const Job = z.object({
  id: z.string(),
  job_id: z.string(),
  source: z.string(),
  company: z.string(),
  title: z.string(),
  location: str,
  remote: z.boolean().nullable().optional(),
  work_mode: str,
  employment_type: str,
  seniority: str,
  salary_min: num,
  salary_max: num,
  currency: str,
  url: str,
  application_url: str,
  posted_at: str,
  first_seen_at: str,
  last_seen_at: str,
  description_truncated: z.boolean().nullable().optional(),
  alternate_sources: z.array(z.unknown()).default([]),
  duplicate_of_id: str,
  salary_is_predicted: z.boolean().default(false),
  skills: z.array(z.string()).default([]),
  match: Match.optional(),
});
export type Job = z.infer<typeof Job>;
export const JobList = z.object({ total: z.number(), page: z.number(), page_size: z.number(), jobs: z.array(Job) });

export const EvidenceItem = z.object({ section: z.string(), source_id: str, text: z.string() });
export const RequirementEvidence = z.object({
  requirement: z.string(),
  category: z.string(),
  tier: z.string(),
  importance: z.number(),
  source_span: z.string().default(""),
  skill: str,
  status: z.string(),
  match_type: z.string(),
  matched: z.boolean(),
  confidence: z.string(),
  evidence: z.array(EvidenceItem).default([]),
  evidence_skill: str,
  note: z.string().default(""),
});
export type RequirementEvidence = z.infer<typeof RequirementEvidence>;

export const JDAnalysis = z
  .object({
    role_title: z.string(),
    seniority: z.string(),
    required_skills: z.array(z.string()),
    preferred_skills: z.array(z.string()),
    nice_to_have_skills: z.array(z.string()),
    education: z.array(z.string()),
    experience_requirements: z.array(z.string()),
    responsibilities: z.array(z.string()),
    min_years: num,
    max_years: num,
    work_mode: str,
    employment_type: str,
    sponsorship: str,
    analyzer_version: z.string(),
  })
  .passthrough();

export const DestinationLinks = z.record(z.string(), z.string());
export const JobDetail = Job.extend({
  description: z.string(),
  analysis: JDAnalysis,
  requirement_matrix: z.array(RequirementEvidence),
  destination_links: DestinationLinks.default({}),
});
export type JobDetail = z.infer<typeof JobDetail>;
export const SearchOut = z.object({ task: Task, destination_links: DestinationLinks, note: z.string() });
export const ImportOut = z.object({ job_id: z.string().nullable(), normalization: record });

// ---------------------------------------------------------------- ATS report
export const Issue = z.object({ type: z.string(), severity: z.string(), message: z.string() });
export const TestResult = z.object({
  name: z.string(),
  status: z.string(),
  score: num,
  critical: z.boolean().default(false),
  severity: z.string().default("info"),
  details: record.default({}),
  issues: z.array(Issue).default([]),
});
export const KeywordResult = z.object({
  keyword: z.string(),
  category: z.string(),
  importance: z.number(),
  classification: z.string(),
  resume_present: z.boolean(),
  evidence_sections: z.array(z.string()).default([]),
  related_to: str,
  occurrences: z.number().default(0),
});
export const Report = z.object({
  resume_version_id: str,
  job_id: str,
  ats_profile: z.string(),
  assessment: z.string(),
  quality_index: z.number(),
  parser_compatibility: z.number(),
  requirement_coverage: num,
  keyword_alignment: num,
  experience_evidence: num,
  experience_relevance: num,
  formatting_compatibility: z.number(),
  round_trip_fidelity: num,
  unsupported_claims: z.number().default(0),
  component_weights: z.record(z.string(), z.number()).default({}),
  score_explanations: z.record(z.string(), z.string()).default({}),
  tests: z.array(TestResult).default([]),
  issues: z.array(Issue).default([]),
  recommendations: z.array(z.string()).default([]),
  keywords: z.array(KeywordResult).default([]),
  requirement_matrix: z.array(RequirementEvidence.partial().passthrough()).default([]),
  extracted_text_preview: z.string().default(""),
  critical_failures: z.array(z.string()).default([]),
  disclaimer: z.string().default(""),
});
export type Report = z.infer<typeof Report>;

export const Templates = z.object({
  templates: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), section_order: z.array(z.string()) })),
  ats_profiles: z.array(z.object({ id: z.string(), description: z.string() })),
});

const Bullet = z.object({
  text: z.string(),
  source_type: z.string(),
  source_id: str,
  original_text: str,
  verified: z.boolean().default(true),
  rewrite_rejected_reasons: z.array(z.string()).default([]),
});
export const ResumeContent = z
  .object({
    contact: Contact,
    summary: str,
    summary_source: z.string().default("none"),
    skills: z.record(z.string(), z.array(z.string())).default({}),
    experience: z
      .array(z.object({ source_id: z.string(), title: str, company: str, location: str, start_date: str, end_date: str, bullets: z.array(Bullet).default([]) }).passthrough())
      .default([]),
    projects: z.array(z.object({ source_id: z.string(), name: z.string(), url: str, bullets: z.array(Bullet).default([]) }).passthrough()).default([]),
    education: z.array(Education).default([]),
    certifications: z.array(Certification).default([]),
    achievements: z.array(z.string()).default([]),
    section_order: z.array(z.string()).default([]),
    template: z.string(),
  })
  .passthrough();
export const Claim = z.object({
  claim: z.string(),
  section: str,
  source_type: str,
  source_id: str,
  original: str,
  verified: z.boolean(),
  confidence: num,
  reasons: z.unknown().optional(),
});
export const VersionDetail = Version.extend({
  content: ResumeContent.nullable(),
  changes: record.nullable().optional(),
  claims: z.array(Claim).default([]),
  text_preview: z.string().default(""),
});
export type VersionDetail = z.infer<typeof VersionDetail>;

export const Change = z.object({
  type: z.string(),
  section: z.string(),
  source_id: str,
  original: str,
  new: str,
  evidence_source: str,
  verified: z.boolean().nullable().optional(),
  detail: str,
});
export const DiffResult = z.object({
  changes: z.array(Change).default([]),
  counts: z.record(z.string(), z.number()).default({}),
  unsupported_additions: z.number().default(0),
});
export const Regression = z.object({
  skills_lost: z.array(z.string()).default([]),
  skills_added: z.array(z.string()).default([]),
  bullets_changed: z.number().default(0),
  bullets_added: z.number().default(0),
  bullets_removed: z.number().default(0),
  score_deltas: z.record(z.string(), z.object({ old: z.number(), new: z.number(), delta: z.number() })).default({}),
  warnings: z.array(z.string()).default([]),
});
export const DiffOut = z.object({ from: Version, to: Version, diff: DiffResult, regression: Regression });
export const TestResults = z.object({
  resume_version_id: z.string(),
  tests: z.array(TestResult.extend({ job_id: str, created_at: str })),
});
export const CompareOut = z.object({
  rows: z.array(
    z.object({
      version: Version,
      quality_index: z.number(),
      keyword_alignment: num,
      requirement_coverage: num,
      required_coverage: num,
      semantic_relevance: num,
      parser_fidelity: num,
      achievement_strength: num,
      words: z.number(),
      unsupported_claims: z.number(),
    }),
  ),
  diffs_vs_first: z.array(DiffResult),
  summary: z.array(z.string()),
  note: z.string(),
});

// ---------------------------------------------------------------- applications
export const Answer = z.object({
  question: z.string(),
  category: z.string(),
  answer: str,
  confidence: z.string(),
  requires_approval: z.boolean(),
  source: z.string(),
  reason: z.string(),
  required: z.boolean().default(false),
  field_name: str,
});
export type Answer = z.infer<typeof Answer>;
export const AppEvent = z.object({
  id: z.string(),
  actor: z.string(),
  action: z.string(),
  from_status: str,
  to_status: str,
  details: record.nullable().optional(),
  notes: str,
  created_at: str,
});
export const Application = z.object({
  id: z.string(),
  job_id: z.string(),
  status: z.string(),
  mode: str,
  applied_at: str,
  application_url: str,
  resume_version_id: str,
  cover_letter: str,
  cover_letter_source: str,
  answers: z.array(Answer).default([]),
  package: record.default({}),
  submission_reference: str,
  notes: str,
  created_at: str,
  updated_at: str,
  job: Job.optional(),
  events: z.array(AppEvent).optional(),
});
export type Application = z.infer<typeof Application>;
export const ApplicationList = z.object({ applications: z.array(Application), statuses: z.array(z.string()) });
export const PrepareOut = z.object({ application_id: z.string(), task: Task });
export const SubmitOut = z.object({
  result: z.object({
    method: z.string(),
    status: z.string(),
    application_url: str,
    submission_reference: str,
    message: z.string(),
    missing_required: z.array(z.string()).default([]),
  }),
  application: Application,
});

// ---------------------------------------------------------------- system
export const Dashboard = z.object({
  has_profile: z.boolean(),
  jobs_found_today: z.number().optional(),
  high_match_jobs: z.number().optional(),
  total_matches: z.number().optional(),
  applications: z.number().optional(),
  applications_by_status: z.record(z.string(), z.number()).optional(),
  interviews: z.number().optional(),
  offers: z.number().optional(),
  pending_actions: z.number().optional(),
  pending_resume_reviews: z.number().nullable().optional(),
  master_resume: Version.nullable().optional(),
  last_discovery_at: str,
  search_frequency: z.string().optional(),
  application_mode: z.string().optional(),
  auto_apply: z.boolean().optional(),
});
export type Dashboard = z.infer<typeof Dashboard>;
export const Notification = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  data: record.nullable().optional(),
  read: z.boolean(),
  created_at: str,
});
export const NotificationList = z.object({ notifications: z.array(Notification), unread: z.number() });
export const Ready = z.object({ status: z.string(), checks: z.record(z.string(), z.unknown()) });
export const Source = z.object({
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  base_url: str,
  configuration: record.nullable().optional(),
  credentials_configured: z.boolean().nullable().optional(),
  scraped: z.boolean(),
});
export const SourceList = z.object({ sources: z.array(Source) });
export const LlmHealth = z
  .object({ configured: z.boolean(), reachable: z.boolean().optional(), model: str, base_url: str })
  .passthrough();
export const LlmTest = z.object({ ok: z.boolean(), parsed: z.unknown(), latency_ms: z.number(), model: z.string() });
export const AgentRuns = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      agent: z.string(),
      status: z.string(),
      job_id: str,
      error: str,
      latency_ms: num,
      model: str,
      prompt_version: str,
      started_at: str,
    }),
  ),
});
export const Ok = z.object({}).passthrough();

// ---------------------------------------------------------------- insights (aggregates of your own data)
export const BriefItem = z.object({
  kind: z.string(),
  tone: z.string(),
  count: z.number(),
  text: z.string(),
  action: z.object({ label: z.string(), href: z.string() }),
});
export const Insights = z.object({
  generated_at: z.string(),
  kpis: z.object({
    high_matches: z.number(),
    saved: z.number(),
    applications: z.number(),
    interviews: z.number(),
    follow_ups_due: z.number(),
    high_threshold: z.number(),
  }),
  brief: z.array(BriefItem),
  funnel: z.object({
    saved: z.number(),
    applied: z.number(),
    responses: z.number(),
    interviews: z.number(),
    offers: z.number(),
    response_rate: num,
    interview_rate: num,
  }),
  resume_performance: z.array(
    z.object({
      resume_version_id: z.string(),
      label: z.string(),
      version_number: num,
      applications: z.number(),
      responses: z.number(),
      interviews: z.number(),
      response_rate: num,
      interview_rate: num,
    }),
  ),
  skill_gaps: z.object({
    based_on_postings: z.number(),
    gaps: z.array(z.object({ skill: z.string(), required_in: z.number(), preferred_in: z.number(), share: z.number(), demand: z.string() })),
    strengths: z.array(z.object({ skill: z.string(), postings: z.number() })),
  }),
  market_skills: z.object({
    based_on_postings: z.number(),
    skills: z.array(z.object({ skill: z.string(), postings: z.number(), share: z.number(), you_have: z.boolean() })),
  }),
  companies: z.array(
    z.object({
      company: z.string(),
      open_roles: z.number(),
      matching_roles: z.number(),
      best_score: num,
      saved: z.number(),
      applications: z.number(),
      sources: z.array(z.string()),
    }),
  ),
  follow_ups: z.array(
    z.object({ application_id: z.string(), job_id: z.string(), title: z.string(), company: z.string(), applied_at: z.string(), days_since_activity: z.number() }),
  ),
});
export type Insights = z.infer<typeof Insights>;
