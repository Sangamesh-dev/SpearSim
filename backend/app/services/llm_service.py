"""
LLM Service — Groq API integration with pseudonymisation enforcement.
All prompts use alias + generic role. Real names never reach the LLM.
"""
import asyncio
import httpx
import bleach
from typing import Optional
from app.config import get_settings
from app.models import ScenarioType, DifficultyLevel

settings = get_settings()

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

ALLOWED_TAGS = [
    "p", "b", "i", "strong", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "a", "span", "div", "br", "table", "tbody", "tr", "td", "th",
    "button"
]
ALLOWED_ATTRIBUTES = {
    "*": ["style", "class"],
    "a": ["href", "target", "title"],
    "button": ["onclick", "type", "style"],
}
ALLOWED_STYLES = [
    "color", "font-weight", "font-style", "text-decoration", "text-align",
    "background-color", "border", "border-radius", "padding", "margin",
    "font-family", "font-size", "display", "border-color", "border-style", "border-width"
]

# Scenario persona mapping
SCENARIO_PERSONAS = {
    "IT Support": "the company IT helpdesk (it-support@company.com)",
    "HR": "the HR department (hr@company.com)",
    "Finance": "the Finance team (finance@company.com)",
    "CEO Fraud": "the CEO (ceo@company.com)",
    "Vendor": "a trusted vendor (billing@vendor-partner.com)",
}

# Difficulty instructions
DIFFICULTY_INSTRUCTIONS = {
    "Low": (
        "Use obvious red flags: generic greeting, urgent tone, suspicious sender domain, "
        "poor grammar, vague CTA. This should be detectable by a security-aware employee."
    ),
    "Medium": (
        "Use moderate sophistication: correct company name, plausible sender, "
        "one or two subtle red flags like mismatched URL or slightly off domain. "
        "Requires attention to spot."
    ),
    "High": (
        "Use high sophistication: personalised greeting using alias, correct department context, "
        "convincing sender spoofing, subtle urgency, no obvious grammar errors. "
        "Only detectable by carefully checking links and sender headers."
    ),
}


async def _groq_chat(
    messages: list[dict],
    temperature: float = 0.8,
    max_tokens: int = 1024,
    retries: int = 3,
) -> str:
    """Make an async call to Groq chat completions API with exponential backoff retries."""
    headers = {
        "Authorization": f"Bearer {settings.groq_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.groq_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(GROQ_API_URL, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"].strip()
        except httpx.HTTPError as exc:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(2 ** attempt)


async def generate_phishing_email(
    alias: str,
    role_generic: str,
    company_name: str,
    scenario_type: str,
    difficulty: str,
    tracking_link: str,
) -> tuple[str, str]:
    """
    Generate a phishing simulation email body and subject line.

    PSEUDONYMISATION: Only alias and role_generic are passed to the LLM.
    Real names and specific job titles are never included in prompts.

    Returns: (subject, body_html)
    """
    persona = SCENARIO_PERSONAS.get(scenario_type, "the IT department")
    difficulty_instruction = DIFFICULTY_INSTRUCTIONS.get(difficulty, DIFFICULTY_INSTRUCTIONS["Medium"])

    # --- Body generation ---
    body_messages = [
        {
            "role": "system",
            "content": (
                "You are a security awareness trainer generating realistic phishing simulation "
                "emails for authorized corporate security training programs. "
                "Output ONLY the email body as valid HTML. "
                "Do NOT include a subject line. "
                "Do NOT include any explanation or preamble. "
                "The email must contain exactly one CTA link styled as a button — use an <a> tag "
                "with href='{{TRACKING_LINK}}' and inline CSS to make it look like a button "
                "(e.g. background-color, padding, border-radius, color, display:inline-block). "
                "Do NOT use a <button> HTML element — it does not work in email clients. "
                "Keep the email under 300 words."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Generate a {difficulty} difficulty phishing simulation email.\n"
                f"Scenario: {scenario_type}\n"
                f"Target: {alias}, a {role_generic} at {company_name}\n"
                f"Sender impersonating: {persona}\n"
                f"Difficulty guidance: {difficulty_instruction}\n"
                f"CTA link href must be exactly: {{{{TRACKING_LINK}}}}\n"
                f"Make this email slightly unique with a variation in wording.\n"
                f"Output only the HTML email body."
            ),
        },
    ]

    # --- Subject generation ---
    subject_messages = [
        {
            "role": "system",
            "content": (
                "You are a security awareness trainer. "
                "Output ONLY a single email subject line — no quotes, no explanation."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Write a {difficulty} difficulty phishing simulation email subject line.\n"
                f"Scenario: {scenario_type}\n"
                f"Sender impersonating: {persona}\n"
                f"Output only the subject line text."
            ),
        },
    ]

    # Run both calls concurrently
    body_html, subject = await asyncio.gather(
        _groq_chat(body_messages, temperature=0.85, max_tokens=800),
        _groq_chat(subject_messages, temperature=0.7, max_tokens=60),
    )

    # Replace placeholder with actual tracking link before sanitizing
    body_html = body_html.replace("{{TRACKING_LINK}}", tracking_link)
    body_html = body_html.replace("{TRACKING_LINK}", tracking_link)

    # In bleach 5.0+, inline styles must be sanitized using a CSSSanitizer instance
    from bleach.css_sanitizer import CSSSanitizer
    css_sanitizer = CSSSanitizer(allowed_css_properties=ALLOWED_STYLES)

    body_html = bleach.clean(
        body_html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        css_sanitizer=css_sanitizer,
        strip=True,
    )

    return subject.strip(), body_html


async def generate_remediation_advice(
    scenario_type: str,
    difficulty: str,
    alias: str,
    role_generic: str,
) -> str:
    """
    Generate AI remediation advice for an at-risk employee.
    Uses alias only — no real name.
    """
    messages = [
        {
            "role": "system",
            "content": (
                "You are a corporate security awareness trainer. "
                "Provide concise, actionable training recommendations. "
                "Be direct and practical. Maximum 3 sentences."
            ),
        },
        {
            "role": "user",
            "content": (
                f"A {role_generic} (alias: {alias}) clicked a link in a {difficulty} difficulty "
                f"phishing simulation with scenario '{scenario_type}'. "
                f"Suggest 2 specific security awareness training actions for this employee. "
                f"Be concise, max 3 sentences total."
            ),
        },
    ]
    return await _groq_chat(messages, temperature=0.5, max_tokens=200)


async def generate_single_email(
    emp: dict,
    company_name: str,
    scenario_type: str,
    difficulty: str,
    base_url: str,
) -> dict:
    """
    Generate a single preview email for one employee.
    Used by the preview-email endpoint — does NOT send or write to DB.
    """
    effective_scenario = emp.get("scenario_override") or scenario_type
    # Use a placeholder tracking link for preview — not a real UUID link
    tracking_link = f"{base_url}/track/click/{emp['uuid']}"
    subject, body_html = await generate_phishing_email(
        alias=emp["alias"],
        role_generic=emp["role_generic"],
        company_name=company_name,
        scenario_type=effective_scenario,
        difficulty=difficulty,
        tracking_link=tracking_link,
    )
    pixel_url = f"{base_url}/track/open/{emp['uuid']}"
    tracking_pixel = f'<img src="{pixel_url}" width="1" height="1" alt="" style="display:none;">'
    body_html_with_pixel = body_html + tracking_pixel

    # Strip HTML tags for plain-text version
    import re as _re
    body_text = _re.sub(r"<[^>]+>", " ", body_html).strip()
    body_text = _re.sub(r"\s+", " ", body_text)

    return {
        "subject": subject,
        "body_html": body_html_with_pixel,
        "body_text": body_text,
        "to_alias": emp["alias"],
    }


async def batch_generate_emails(
    employees: list[dict],
    company_name: str,
    scenario_type: str,
    difficulty: str,
    base_url: str,
) -> list[dict]:
    """
    Batch generate phishing emails for all employees concurrently.
    Each employee dict must have: alias, role_generic, uuid
    """
    async def generate_one(emp: dict) -> dict:
        # Per-employee scenario override for multi-scenario support
        effective_scenario = emp.get("scenario_override") or scenario_type
        tracking_link = f"{base_url}/track/click/{emp['uuid']}"
        subject, body_html = await generate_phishing_email(
            alias=emp["alias"],
            role_generic=emp["role_generic"],
            company_name=company_name,
            scenario_type=effective_scenario,
            difficulty=difficulty,
            tracking_link=tracking_link,
        )
        # Inject tracking pixel
        pixel_url = f"{base_url}/track/open/{emp['uuid']}"
        tracking_pixel = f'<img src="{pixel_url}" width="1" height="1" alt="" style="display:none;">'
        body_html = body_html + tracking_pixel

        return {
            "alias": emp["alias"],
            "employee_uuid": emp["uuid"],
            "email": emp["email"],
            "subject": subject,
            "body_html": body_html,
            "tracking_pixel_url": pixel_url,
            "cta_url": tracking_link,
        }

    # Semaphore to avoid rate limiting (max 5 concurrent)
    semaphore = asyncio.Semaphore(5)

    async def generate_with_semaphore(emp: dict) -> dict:
        async with semaphore:
            return await generate_one(emp)

    results = await asyncio.gather(
        *[generate_with_semaphore(emp) for emp in employees],
        return_exceptions=True,
    )

    # Filter out exceptions, log them
    valid_results = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            print(f"[LLM] Failed to generate email for employee {employees[i].get('alias')}: {result}")
        else:
            valid_results.append(result)

    return valid_results
