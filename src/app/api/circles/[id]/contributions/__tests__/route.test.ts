/**
 * @jest-environment node
 */
import { GET } from "@/app/api/circles/[id]/contributions/route";
import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock("@/server/services/contribution.service", () => ({
  getContributionsByCircle: jest.fn(),
  getContributionsByCircleFiltered: jest.fn(),
  isCircleMember: jest.fn(),
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/server/middleware", () => ({
  withErrorHandler: (handler: any) => handler,
}));

import * as contribService from "@/server/services/contribution.service";
import * as nextAuth from "next-auth";

const mockGetServerSession = nextAuth.getServerSession as jest.MockedFunction<typeof nextAuth.getServerSession>;
const mockIsCircleMember = contribService.isCircleMember as jest.MockedFunction<typeof contribService.isCircleMember>;
const mockGetFiltered = contribService.getContributionsByCircleFiltered as jest.MockedFunction<typeof contribService.getContributionsByCircleFiltered>;
const mockGetLegacy = contribService.getContributionsByCircle as jest.MockedFunction<typeof contribService.getContributionsByCircle>;

const MOCK_USER = { id: "user-1", role: "member" };

const MOCK_CONTRIB_ROWS = [
  {
    id: "contrib-1",
    cycleNumber: 1,
    amountUsdc: "10.0000000",
    status: "confirmed",
    createdAt: "2024-01-15T10:00:00.000Z",
    memberName: "Alice",
    memberId: "member-1",
    currency: "NGN",
    paidAt: "2024-01-15T10:05:00.000Z",
  },
  {
    id: "contrib-2",
    cycleNumber: 1,
    amountUsdc: "10.0000000",
    status: "pending",
    createdAt: "2024-01-16T10:00:00.000Z",
    memberName: "Bob",
    memberId: "member-2",
    currency: "NGN",
    paidAt: null,
  },
];

function makeRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: MOCK_USER });
  mockIsCircleMember.mockResolvedValue({ isMember: true, isAdmin: false });
  mockGetFiltered.mockResolvedValue({
    items: MOCK_CONTRIB_ROWS,
    nextCursor: null,
    hasMore: false,
    total: 2,
  });
  mockGetLegacy.mockResolvedValue({ data: MOCK_CONTRIB_ROWS, total: 2 });
});

describe("GET /api/circles/[id]/contributions", () => {
  it("returns 401 when no session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions");
    const res = await GET(req, { params: { id: "circle-1" } });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-members", async () => {
    mockIsCircleMember.mockResolvedValue({ isMember: false, isAdmin: false });
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions");
    const res = await GET(req, { params: { id: "circle-1" } });
    expect(res.status).toBe(403);
  });

  it("allows platform admin even if not a circle member", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    mockIsCircleMember.mockResolvedValue({ isMember: false, isAdmin: false });
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions");
    const res = await GET(req, { params: { id: "circle-1" } });
    expect(res.status).toBe(200);
  });

  it("allows circle creator (isAdmin) even without membership", async () => {
    mockIsCircleMember.mockResolvedValue({ isMember: false, isAdmin: true });
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions");
    const res = await GET(req, { params: { id: "circle-1" } });
    expect(res.status).toBe(200);
  });

  it("returns paginated contributions with cursor response shape", async () => {
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions?limit=20");
    const res = await GET(req, { params: { id: "circle-1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty("items");
    expect(json.data).toHaveProperty("nextCursor");
    expect(json.data).toHaveProperty("hasMore");
    expect(json.data).toHaveProperty("total");
    expect(json.data.items).toHaveLength(2);
    // Response includes member display name, amount, currency, and payment timestamp
    expect(json.data.items[0]).toHaveProperty("memberName");
    expect(json.data.items[0]).toHaveProperty("amountUsdc");
    expect(json.data.items[0]).toHaveProperty("currency");
    expect(json.data.items[0]).toHaveProperty("paidAt");
  });

  it("passes cycle filter to the service", async () => {
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions?cycle=2");
    await GET(req, { params: { id: "circle-1" } });
    expect(mockGetFiltered).toHaveBeenCalledWith(
      "circle-1",
      { cycle: 2, status: undefined },
      undefined,
      20
    );
  });

  it("passes status filter to the service (paid → confirmed normalisation)", async () => {
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions?status=paid");
    await GET(req, { params: { id: "circle-1" } });
    expect(mockGetFiltered).toHaveBeenCalledWith(
      "circle-1",
      { cycle: undefined, status: "confirmed" },
      undefined,
      20
    );
  });

  it("passes both cycle and status filters", async () => {
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions?cycle=1&status=pending");
    await GET(req, { params: { id: "circle-1" } });
    expect(mockGetFiltered).toHaveBeenCalledWith(
      "circle-1",
      { cycle: 1, status: "pending" },
      undefined,
      20
    );
  });

  it("returns 400 for invalid cycle (non-integer)", async () => {
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions?cycle=abc");
    const res = await GET(req, { params: { id: "circle-1" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid cycle (negative)", async () => {
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions?cycle=-1");
    const res = await GET(req, { params: { id: "circle-1" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid status", async () => {
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions?status=invalid");
    const res = await GET(req, { params: { id: "circle-1" } });
    expect(res.status).toBe(400);
  });

  it("returns legacy page/limit response when page param is present", async () => {
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions?page=1&limit=10");
    const res = await GET(req, { params: { id: "circle-1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveProperty("data");
    expect(json.data).toHaveProperty("total");
    expect(json.data).toHaveProperty("page");
    expect(json.data).toHaveProperty("limit");
  });

  it("encodes nextCursor as base64url when hasMore is true", async () => {
    mockGetFiltered.mockResolvedValue({
      items: MOCK_CONTRIB_ROWS,
      nextCursor: "2024-01-16T10:00:00.000Z",
      hasMore: true,
      total: 5,
    });
    const req = makeRequest("http://localhost/api/circles/circle-1/contributions?limit=2");
    const res = await GET(req, { params: { id: "circle-1" } });
    const json = await res.json();
    expect(json.data.hasMore).toBe(true);
    expect(json.data.nextCursor).toBeTruthy();
    // Should be a base64url-encoded string (no +/= chars)
    expect(json.data.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
