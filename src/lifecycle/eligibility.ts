export interface MemoryEligibility {
  durable: boolean;
  reusable: boolean;
  userSpecific: boolean;
  actionable: boolean;
  likelyToMatterLater: boolean;
  transient: boolean;
  sensitive: boolean;
  eligible: boolean;
  reason: string;
}

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /\b(what(?:'|’)s|what is) the time\b/i,
  /\b(it is|it's) \d{1,2}(:\d{2})?\s*(am|pm)?\b/i,
  /\b(good morning|good afternoon|good evening|hello|hi there|hey)\b/i,
  /\bjust opened\b/i,
  /\bopened (the )?file\b/i,
  /\brandom(ly)?\b/i,
  /\botp\b/i,
  /\bone[- ]time\b/i,
  /\btemporary output\b/i,
  /\bscratch\b/i,
  /\bthis (is|was) just a test\b/i,
];

const ACTIONABLE_PATTERNS: readonly RegExp[] = [
  /\b(prefer|preferred|please always|always|never|must|should|do not|don't|use|uses|using)\b/i,
  /\b(remember|constraint|decision|decided|procedure|workflow|policy)\b/i,
  /\b(project|repo|repository|package manager|editor|database|runtime)\b/i,
];

const USER_SPECIFIC_PATTERNS: readonly RegExp[] = [
  /\b(i|i'm|i am|my|we|our|user)\b/i,
  /\b(prefer|like|want|hate|always|never)\b/i,
];

export function evaluateEligibility(
  content: string,
  options: { explicit?: boolean; sensitive?: boolean } = {},
): MemoryEligibility {
  const text = content.trim();
  const transient = TRANSIENT_PATTERNS.some((pattern) => pattern.test(text)) || looksLikeEphemera(text);
  const actionable = ACTIONABLE_PATTERNS.some((pattern) => pattern.test(text));
  const userSpecific = USER_SPECIFIC_PATTERNS.some((pattern) => pattern.test(text));
  const durable = !transient && text.length >= 8 && !looksLikeNoise(text);
  const reusable = durable && (actionable || userSpecific || Boolean(options.explicit));
  const likelyToMatterLater = reusable;
  const sensitive = Boolean(options.sensitive);

  if (options.explicit && !sensitive) {
    return {
      durable: true,
      reusable: true,
      userSpecific: true,
      actionable: true,
      likelyToMatterLater: true,
      transient: false,
      sensitive,
      eligible: true,
      reason: "explicit_user_request",
    };
  }

  if (sensitive) {
    return {
      durable,
      reusable: false,
      userSpecific,
      actionable,
      likelyToMatterLater: false,
      transient,
      sensitive,
      eligible: false,
      reason: "sensitive_or_secret",
    };
  }

  if (transient) {
    return {
      durable: false,
      reusable: false,
      userSpecific,
      actionable,
      likelyToMatterLater: false,
      transient: true,
      sensitive,
      eligible: false,
      reason: "transient_observation",
    };
  }

  if (!likelyToMatterLater) {
    return {
      durable,
      reusable,
      userSpecific,
      actionable,
      likelyToMatterLater,
      transient,
      sensitive,
      eligible: false,
      reason: "low_value_observation",
    };
  }

  return {
    durable,
    reusable,
    userSpecific,
    actionable,
    likelyToMatterLater,
    transient,
    sensitive,
    eligible: true,
    reason: "eligible_observation",
  };
}

function looksLikeNoise(text: string): boolean {
  if (text.length < 4) return true;
  if (/^[0-9\s.:/-]+$/.test(text)) return true;
  if (/^(ok|okay|thanks|thank you|cool|nice|lol|lgtm|done|wip)$/i.test(text)) return true;
  return false;
}

function looksLikeEphemera(text: string): boolean {
  if (/\b(now|currently) it is\b/i.test(text)) return true;
  if (/\b(today is|the date is)\b/i.test(text) && !/\bdeadline\b/i.test(text)) return true;
  if (/\b(random number|uuid|nonce)\b/i.test(text)) return true;
  return false;
}
