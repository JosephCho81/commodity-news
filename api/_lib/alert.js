// api/_lib/alert.js — 운영 알림 이메일 (Resend). RESEND_API_KEY 없으면 조용히 skip.

export async function sendFailureAlert(subject, reason, note = '') {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: 'noreply@resend.dev',
        to: 'joseph@a1kor.com',
        subject: `[A1KOR 원자재] ${subject}`,
        html: `
          <h2>⚠️ ${subject}</h2>
          <p><b>시각:</b> ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (KST)</p>
          <p><b>원인:</b> ${reason}</p>
          ${note ? `<p>${note}</p>` : ''}
          <hr/>
          <p style="color:#888;font-size:12px">(주)한국에이원 원자재 인텔리전스 시스템</p>
        `,
      }),
    });
    console.log('[Alert] 실패 알림 이메일 발송 완료');
  } catch (e) {
    console.warn('[Alert] 이메일 발송 실패 (무시):', e.message);
  }
}
