export type Guid = string;

export interface Money {
  amount: number;
  currencyCode: string;
}

export interface SeveraError {
  httpStatusCode: number;
  type: string;
  message: string;
}

export interface UserWithName {
  guid: Guid;
  firstName?: string;
  lastName?: string;
  email?: string;
  userName?: string;
  isActive?: boolean;
}

export interface CustomerModel {
  guid: Guid;
  name: string;
  code?: string;
  number?: string;
  isActive?: boolean;
  vatNumber?: string | null;
}

export interface PhaseSubModel {
  guid: Guid;
  name: string;
  isClosed?: boolean;
}

export interface SalesStatusSubModel {
  guid: Guid;
  name: string;
  isClosed?: boolean;
  isWon?: boolean;
}

export interface ProjectOutputModel {
  guid: Guid;
  name: string;
  number?: string;
  customer?: { guid: Guid; name: string };
  projectOwner?: UserWithName;
  salesPerson?: UserWithName;
  salesStatus?: SalesStatusSubModel;
  probability?: number;
  expectedValue?: Money;
  expectedOrderDate?: string;
  phases?: PhaseSubModel[];
  isInternal?: boolean;
  isClosed?: boolean;
  closedDate?: string;
  currency?: { guid: Guid; code: string };
}

export interface WorkHourOutputModel {
  guid: Guid;
  user: UserWithName;
  project: { guid: Guid; name: string };
  customer?: { guid: Guid; name: string };
  phase?: PhaseSubModel;
  workType?: { guid: Guid; name: string };
  eventDate: string;
  startTime?: string;
  endTime?: string;
  quantity: number;
  description?: string;
  billableStatus?: "Billable" | "NotBillable" | "RemovedFromInvoice";
  isBillable?: boolean;
  isApproved?: boolean;
  invoice?: { guid: Guid; number?: string } | null;
  invoiceQuantity?: number;
}

export interface ProjectForecastOutputModel {
  guid: Guid;
  project?: { guid: Guid };
  month?: number;
  year?: number;
  billingForecast?: Money;
  billingForecastNotes?: string | null;
  revenueForecast?: Money;
  revenueForecastNotes?: string | null;
  expenseForecast?: Money;
  expenseForecastNotes?: string | null;
  laborExpenseForecast?: Money;
  laborExpenseForecastNotes?: string | null;
}

export interface SalesStatusTypeOutputModel {
  guid: Guid;
  name?: string;
  isActive?: boolean;
  salesState?: "InProgress" | "Won" | "Lost";
  defaultProbability?: number;
}

export interface InvoiceStatusSubModel {
  guid: Guid;
  name?: string;
}

export interface InvoiceOutputModel {
  guid: Guid;
  number?: string | number;
  referenceNumber?: string;
  date?: string;
  dueDate?: string;
  paymentDate?: string | null;
  invoiceStatus?: InvoiceStatusSubModel;
  customer?: { guid: Guid; name: string };
  project?: { guid: Guid; name: string };
  salesPerson?: UserWithName;
  projectOwner?: UserWithName;
  totalExcludingTax?: Money;
  totalIncludingTax?: Money;
  createdDateTime?: string;
  lastUpdatedDateTime?: string;
  createdBy?: UserWithName;
}

export interface InvoiceRowOutputModel {
  guid: Guid;
  invoice?: { guid: Guid; number?: string | number };
  description?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: Money;
  totalPrice?: Money;
  workType?: { guid: Guid; name: string };
  product?: { guid: Guid; name: string };
  phase?: PhaseSubModel;
}

export interface ProposalOutputModel {
  guid: Guid;
  name?: string;
  number?: string | number;
  customer?: { guid: Guid; name: string };
  project?: { guid: Guid; name: string };
  proposalStatus?: { guid: Guid; name?: string };
  salesPerson?: UserWithName;
  expectedValue?: Money;
  probability?: number;
  expectedOrderDate?: string;
  createdDateTime?: string;
  lastUpdatedDateTime?: string;
}

export interface ActivityModel {
  guid: Guid;
  name?: string;
  description?: string;
  isClosed?: boolean;
  isApproved?: boolean;
  activityType?: { guid: Guid; name?: string };
  activityCategory?: string;
  customer?: { guid: Guid; name: string };
  project?: { guid: Guid; name: string };
  phase?: PhaseSubModel;
  user?: UserWithName;
  startDateTime?: string;
  endDateTime?: string;
  durationInMinutes?: number;
  workHours?: number;
}

export interface UserOutputModel extends UserWithName {
  code?: string;
  businessUnit?: { guid: Guid; name?: string };
  supervisorUser?: UserWithName;
  keywords?: { guid?: Guid; value?: string; name?: string }[];
  title?: string;
  purpose?: string;
  permissionProfile?: { guid: Guid; name?: string };
  createdDateTime?: string;
  lastUpdatedDateTime?: string;
}

export interface ContactModel {
  guid: Guid;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  title?: string;
  customer?: { guid: Guid; name: string };
  isActive?: boolean;
  isDeleted?: boolean;
  role?: { guid: Guid; name?: string };
  lastUpdatedDateTime?: string;
}

export interface ProductOutputModel {
  guid: Guid;
  name?: string;
  code?: string;
  type?: string;
  isActive?: boolean;
  description?: string;
  category?: { guid: Guid; name?: string };
  unit?: string;
  unitPrice?: Money;
  createdDateTime?: string;
  lastUpdatedDateTime?: string;
}

export interface TimeEntryModel {
  guid: Guid;
  user?: UserWithName;
  timeEntryType?: { guid: Guid; name?: string };
  phase?: PhaseSubModel;
  project?: { guid: Guid; name: string };
  eventDate?: string;
  startTime?: string;
  endTime?: string;
  quantity?: number;
  description?: string;
}

export interface WorkdayOutputModel {
  guid: Guid;
  user?: UserWithName;
  eventDate?: string;
  workHours?: number;
  isCompleted?: boolean;
  startTime?: string;
  endTime?: string;
  flextimeAdjustment?: number;
  workHoursByType?: { workType?: { guid: Guid; name?: string }; quantity?: number }[];
}

export interface ResourceAllocationOutputModel {
  guid: Guid;
  project?: { guid: Guid; name: string };
  phase?: PhaseSubModel;
  user?: UserWithName;
  startDate?: string;
  endDate?: string;
  allocationType?: string;
  hoursAllocated?: number;
  percentageAllocated?: number;
  note?: string;
}

export interface RoleAllocationOutputModel {
  guid: Guid;
  role?: { guid: Guid; name?: string };
  project?: { guid: Guid; name: string };
  phase?: PhaseSubModel;
  startDate?: string;
  endDate?: string;
  hoursAllocated?: number;
  salesProbability?: number;
}

export interface ProjectFeeOutputModel {
  guid: Guid;
  project?: { guid: Guid; name: string };
  user?: UserWithName;
  eventDate?: string;
  description?: string;
  quantity?: number;
  unitPrice?: Money;
  totalPrice?: Money;
  billableStatus?: "Billable" | "NotBillable" | "RemovedFromInvoice";
  invoice?: { guid: Guid; number?: string | number } | null;
}

export interface ProjectTravelExpenseOutputModel {
  guid: Guid;
  project?: { guid: Guid; name: string };
  user?: UserWithName;
  travelExpenseType?: { guid: Guid; name?: string };
  eventDate?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  totalPrice?: Money;
  billableStatus?: "Billable" | "NotBillable" | "RemovedFromInvoice";
  invoice?: { guid: Guid; number?: string | number } | null;
}

export interface TravelReimbursementOutputModel {
  guid: Guid;
  user?: UserWithName;
  status?: { guid: Guid; name?: string };
  startDate?: string;
  endDate?: string;
  destination?: string;
  purpose?: string;
  totalAmount?: Money;
  lastUpdatedDateTime?: string;
}

export interface PhaseOutputModel {
  guid: Guid;
  name?: string;
  code?: string;
  description?: string;
  project?: { guid: Guid; name: string };
  parentPhase?: { guid: Guid; name?: string };
  phaseStatus?: { guid: Guid; name?: string; isClosed?: boolean };
  startDate?: string;
  deadline?: string;
  isClosed?: boolean;
}

export interface FlatRateOutputModel {
  guid: Guid;
  project?: { guid: Guid; name?: string };
  phase?: { guid: Guid; name?: string };
  invoiceGuid?: Guid;
  billingSchedule?: string;
  plannedBillingDate?: string;
  price?: Money;
  pricePerAdditionalHour?: Money;
  includesHours?: number;
  billAdditionalHours?: boolean;
}

export interface ProjectRecurringFeeRuleOutputModel {
  guid: Guid;
  name?: string;
  description?: string;
  project?: { guid: Guid; name?: string };
  phase?: { guid: Guid; name?: string };
  customer?: { guid: Guid; name?: string };
  product?: { guid: Guid; name?: string };
  productType?: string;
  quantity?: number;
  unitPrice?: Money;
  unitCost?: Money;
  frequency?: string;
  recurrenceStartDate?: string;
  recurrenceEndDate?: string;
  recurrenceEndType?: string;
  recurrenceTimes?: number;
  generatedTimes?: number;
  isActive?: boolean;
}

export interface ProposalFeeRowOutputModel {
  guid: Guid;
  name?: string;
  description?: string;
  proposal?: { guid: Guid };
  product?: { guid: Guid; name?: string };
  quantity?: number;
  unitPrice?: Money;
  unitCost?: Money;
  subtotal?: Money;
  measurementUnit?: string;
  sortOrder?: number;
  isShownOnProposal?: boolean;
}

export interface ProposalSubtotalOutputModel {
  guid: Guid;
  name?: string;
  description?: string;
  proposal?: { guid: Guid };
  phase?: { guid: Guid; name?: string };
  sortOrder?: number;
  isShownOnProposal?: boolean;
}

export interface ProposalWorkhourRowOutputModel {
  guid: Guid;
  name?: string;
  description?: string;
  proposal?: { guid: Guid };
  phase?: { guid: Guid; name?: string };
  workType?: { guid: Guid; name?: string };
  quantity?: number;
  unitPrice?: Money;
  unitCost?: Money;
  subtotal?: Money;
  sortOrder?: number;
  isShownOnProposal?: boolean;
}

export interface BankAccountOutputModel {
  guid: Guid;
  accountNumber?: string;
  accountNumberFormat?: string;
  bankName?: string;
  bic?: string;
  company?: { guid: Guid; name?: string };
  businessUnit?: { guid: Guid; name?: string };
  isActive?: boolean;
}

export interface AccountModel {
  guid: Guid;
  name?: string;
  number?: string;
  isActive?: boolean;
  isProductDefault?: boolean;
  isTravelTypeDefault?: boolean;
  isWorkTypeDefault?: boolean;
}

export interface KpiFormulaOutputModel {
  guid: Guid;
  name?: string;
  category?: string;
  dataType?: string;
  unit?: string;
  isActive?: boolean;
}

export interface CustomerMarketSegmentModel {
  guid: Guid;
  customer?: { guid: Guid; name?: string };
  marketSegment?: { guid: Guid; name?: string };
  parentMarketSegment?: { guid: Guid; name?: string };
}

export interface FileMetadataModel {
  guid: Guid;
  fileGuid?: Guid;
  name?: string;
  size?: number;
  contentType?: string;
  description?: string;
  category?: { guid: Guid; name?: string };
  isInternal?: boolean;
  isReadOnly?: boolean;
  createdDateTime?: string;
  lastUpdatedDateTime?: string;
  createdBy?: { guid: Guid; firstName?: string; lastName?: string; name?: string };
  projectGuid?: Guid;
  invoiceGuid?: Guid;
  travelExpenseGuid?: Guid;
  customer?: { guid: Guid; name?: string };
}

export interface ContactCommunicationModel {
  guid: Guid;
  value?: string;
  isForbiddenToUse?: boolean;
  contact?: { guid: Guid };
  communicationType?: { guid: Guid; name?: string };
  createdDateTime?: string;
  lastUpdatedDateTime?: string;
}

export interface PhaseMemberOutputModel {
  guid: Guid;
  user?: { guid: Guid; firstName?: string; lastName?: string; name?: string };
  phase?: { guid: Guid; name?: string };
  isActive?: boolean;
  currentWorkContractTitle?: string;
  createdDateTime?: string;
  lastUpdatedDateTime?: string;
}

export interface OvertimeOutputModel {
  guid: Guid;
  name?: string;
  code?: string;
  percentage?: number;
  isActive?: boolean;
  includeInFlextime?: boolean;
  multipliesUnitCost?: boolean;
}

export interface HolidayOutputModel {
  guid: Guid;
  name?: string;
  date?: string;
  countryGuid?: string;
  isActive?: boolean;
  isRecurringYearly?: boolean;
  recurringEndYear?: number;
  isPublicHoliday?: boolean;
}

export interface RoleOutputModel {
  guid: Guid;
  name?: string;
  isActive?: boolean;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  access_token_type: string;
  access_token_expires_in: number;
  scope?: string;
}
