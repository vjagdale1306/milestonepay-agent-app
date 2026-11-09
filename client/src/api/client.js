const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const timeoutMs = options.timeoutMs || 30000;
  const isVerify = Boolean(options.isVerify);

  const headers = { ...(options.headers || {}) };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const timeoutError = new Error('This is taking longer than expected. Refresh the project to see its current status.');
      timeoutError.status = 408;
      throw timeoutError;
    }
    const netError = new Error("The server isn't responding. Please try again in a moment.");
    netError.status = 503;
    throw netError;
  } finally {
    clearTimeout(timeoutId);
  }

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (parseErr) {
      data = null;
    }
  }

  if (!response.ok) {
    let message = data?.error;

    if (!message && response.status >= 500) {
      message = "The server isn't responding. Please try again in a moment.";
    }

    if (response.status === 503 && isVerify) {
      message = 'The AI service is busy, nothing was changed, please try again';
    }

    if (!message) {
      message = `Request failed with status ${response.status}`;
    }

    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export async function createProject(projectData) {
  return request('/api/projects', {
    method: 'POST',
    body: JSON.stringify(projectData),
  });
}

export async function getProject(id) {
  return request(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

export async function fundMilestone(id) {
  return request(`/api/milestones/${encodeURIComponent(id)}/fund`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function confirmMilestone(id) {
  return request(`/api/milestones/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function submitMilestone(id, submissionData) {
  return request(`/api/milestones/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
    body: JSON.stringify(submissionData),
  });
}

export async function verifyMilestone(id) {
  return request(`/api/milestones/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 90000,
    isVerify: true,
  });
}

export async function reviewMilestone(id, reviewData) {
  return request(`/api/milestones/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify(reviewData),
  });
}

export async function retryCaptureMilestone(id) {
  return request(`/api/milestones/${encodeURIComponent(id)}/retry-capture`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function releaseAuthorization(id) {
  return request(`/api/milestones/${encodeURIComponent(id)}/release-authorization`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
