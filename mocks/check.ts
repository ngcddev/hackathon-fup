// Verifica en compilación (npx tsc --noEmit) que cada mock cumple el contrato.
// TypeScript ensancha los literales de un JSON importado (un "admin" queda como
// `string`), por eso se compara contra Widen<Tipo>: se comprueban claves,
// nulabilidad y tipos primitivos. Los valores de los enums (rol, estado,
// severidad...) quedan cubiertos solo al revisar el mock a mano.

import type {
  AdminLogsResponse,
  AlertSuggestionRequest,
  AlertSuggestionResponse,
  ApplyBatchResponse,
  CreateBatchRequest,
  CreateBatchResponse,
  CreateUserRequest,
  KpisResponse,
  ListUsersResponse,
  MeResponse,
  QueryLogsResponse,
  QueryRequest,
  QueryResponse,
  ResetPasswordRequest,
  RevertBatchResponse,
  SendRowsRequest,
  SendRowsResponse,
  SourcesResponse,
  UpdateUserRequest,
  UserResponse,
} from '@/lib/types/api';

import adminLogs from './admin-logs.json';
import alertsSuggestion from './alerts-suggestion.json';
import adminUsersCreate from './admin-users-create.json';
import adminUsersList from './admin-users-list.json';
import adminUsersResetPassword from './admin-users-reset-password.json';
import adminUsersUpdate from './admin-users-update.json';
import importBatchesApply from './import-batches-apply.json';
import importBatchesCreate from './import-batches-create.json';
import importBatchesRevert from './import-batches-revert.json';
import importBatchesRows from './import-batches-rows.json';
import kpis from './kpis.json';
import me from './me.json';
import query from './query.json';
import sources from './sources.json';

type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null
        ? null
        : T extends readonly (infer U)[]
          ? Widen<U>[]
          : T extends object
            ? { [K in keyof T]: Widen<T[K]> }
            : T;

interface Mock<Req, Res> {
  _simulated: boolean;
  request: Widen<Req>;
  response: Widen<Res>;
}

export const mocks = {
  me: me satisfies Mock<null, MeResponse>,
  query: query satisfies Mock<QueryRequest, QueryResponse>,
  kpis: kpis satisfies Mock<{ service: string }, KpisResponse>,
  alertsSuggestion: alertsSuggestion satisfies Mock<AlertSuggestionRequest, AlertSuggestionResponse>,
  sources: sources satisfies Mock<null, SourcesResponse>,
  importBatchesCreate: importBatchesCreate satisfies Mock<CreateBatchRequest, CreateBatchResponse>,
  importBatchesRows: importBatchesRows satisfies Mock<SendRowsRequest, SendRowsResponse>,
  importBatchesApply: importBatchesApply satisfies Mock<null, ApplyBatchResponse>,
  importBatchesRevert: importBatchesRevert satisfies Mock<null, RevertBatchResponse>,
  adminUsersList: adminUsersList satisfies Mock<null, ListUsersResponse>,
  adminUsersCreate: adminUsersCreate satisfies Mock<CreateUserRequest, UserResponse>,
  adminUsersUpdate: adminUsersUpdate satisfies Mock<UpdateUserRequest, UserResponse>,
  adminUsersResetPassword: adminUsersResetPassword satisfies Mock<ResetPasswordRequest, UserResponse>,
  adminLogs: adminLogs satisfies Mock<{ type: string; limit: number }, QueryLogsResponse | AdminLogsResponse>,
};
