from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.deps import get_session
from app.schemas.admin import DeviceListResponse, EmployeeListResponse, PolicyListResponse
from app.services.queries import QueryService

router = APIRouter(prefix="/api", tags=["admin"])


@router.get("/employees", response_model=EmployeeListResponse)
def list_employees(session: Session = Depends(get_session)) -> EmployeeListResponse:
    return QueryService(session).list_employees()


@router.get("/devices", response_model=DeviceListResponse)
def list_devices(session: Session = Depends(get_session)) -> DeviceListResponse:
    return QueryService(session).list_devices()


@router.get("/policies", response_model=PolicyListResponse)
def list_policies(session: Session = Depends(get_session)) -> PolicyListResponse:
    return QueryService(session).list_policies()
