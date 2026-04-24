-- Migration: init_seed_function
-- Version: 20260421185558
-- Pulled from production DB schema_migrations table

create or replace function seed_tenant_defaults(_tenant_id uuid)
returns void language plpgsql security definer
set search_path = public as $fn$
begin
  -- DBPR checklist (37 items)
  insert into inspection_checks (tenant_id, code, title, passed)
  select _tenant_id, code, title, false
  from (values
    ('01A','Hand-washing stations accessible, stocked'),
    ('01B','Toilet facilities clean, operational'),
    ('02A','Food from approved source'),
    ('02B','Food received at proper temp'),
    ('03A','Cold holding 41F or below'),
    ('03B','Hot holding 135F or above'),
    ('03C','Cooking temps correct'),
    ('03D','Cooling procedures adequate'),
    ('04A','Date marking on TCS foods'),
    ('04B','Consumer advisory posted if applicable'),
    ('05A','Employee health policy in place'),
    ('05B','No bare-hand contact with RTE food'),
    ('06A','Sanitizer concentration correct'),
    ('06B','Three-compartment sink procedure'),
    ('07A','Walk-in cooler gaskets intact'),
    ('07B','Reach-in cooler maintenance'),
    ('08A','Hood filters clean, in place'),
    ('08B','Hood/ductwork cleaned professionally'),
    ('08C','Fire extinguishers tagged, accessible'),
    ('09A','Grease trap maintained'),
    ('10A','Pest control program current'),
    ('10B','No signs of pests'),
    ('11A','Chemicals stored away from food'),
    ('11B','SDS sheets on site'),
    ('12A','Floors clean, in good repair'),
    ('12B','Walls/ceilings clean'),
    ('12C','Ventilation adequate'),
    ('13A','Dumpster area clean, closed'),
    ('13B','Grease container not overflowing'),
    ('14A','Restroom supplies stocked'),
    ('15A','DBPR license posted, current'),
    ('15B','Food manager certification on site'),
    ('15C','Employee food handler training'),
    ('16A','Backflow prevention device tested'),
    ('16B','Water temperature adequate'),
    ('17A','Ice scoop stored properly'),
    ('17B','Ice machine clean')
  ) as v(code, title)
  on conflict (tenant_id, code) do nothing;

  -- Task library (32 items)
  insert into tasks (tenant_id, library_id, title, detail, frequency, category, severity, estimated_minutes, is_vendor) values
    (_tenant_id,'d-open-temps','AM temperature check','Record walk-in, reach-ins, hot wells at open','daily','Food Safety','critical',10,false),
    (_tenant_id,'d-open-fire-access','Fire extinguisher access check','Verify all extinguishers unblocked, visible','daily','Fire Safety','critical',5,false),
    (_tenant_id,'d-open-sani','Sanitizer setup','Mix 3-comp sink + sani buckets, test ppm','daily','Food Safety','critical',10,false),
    (_tenant_id,'d-close-hood-filters','Clean hood filters','Degrease + soak hood filters nightly','daily','Fire Safety','important',20,false),
    (_tenant_id,'d-close-temps','PM temperature check','Record holding temps at close','daily','Food Safety','important',10,false),
    (_tenant_id,'d-close-floors','Deep-clean kitchen floors','Degrease, squeegee, sanitize','daily','Cleaning','routine',30,false),
    (_tenant_id,'d-close-waste','Waste log + trash out','Record waste, close dumpster','daily','Operations','routine',15,false),
    (_tenant_id,'d-cash-reconcile','Cash reconciliation','Count drawer vs POS, log deposit','daily','Operations','important',15,false),
    (_tenant_id,'w-grease-trap','Grease trap inspection','Visual check, record depth, schedule pump if >25%','weekly','Compliance','critical',15,false),
    (_tenant_id,'w-walkin-deep','Walk-in deep clean','Empty, wash floors/shelves, sanitize','weekly','Cleaning','important',45,false),
    (_tenant_id,'w-inventory','Full inventory count','Count all product, reconcile usage','weekly','Operations','important',90,false),
    (_tenant_id,'w-dry-storage','Dry storage rotation','FIFO check, expired product out','weekly','Food Safety','important',30,false),
    (_tenant_id,'w-drain-clean','Drain cleaning','Enzyme treatment in all floor drains','weekly','Cleaning','routine',15,false),
    (_tenant_id,'w-schedule-post','Post next week schedule','Finalize + post staff schedule','weekly','Operations','important',30,false),
    (_tenant_id,'w-receiving-audit','Receiving audit','Verify invoices vs delivery, temp check','weekly','Operations','routine',20,false),
    (_tenant_id,'w-training-huddle','Staff training huddle','15-min training on one food safety topic','weekly','Training','routine',15,false),
    (_tenant_id,'m-fire-inspect','Fire extinguisher monthly inspection','NFPA 10: visual check, sign tag','monthly','Fire Safety','critical',15,false),
    (_tenant_id,'m-pest-service','Pest control service','Licensed vendor service + report','monthly','Compliance','critical',60,true),
    (_tenant_id,'m-grease-trap-pump','Grease trap pump','Licensed hauler if 25% or 30 days','monthly','Compliance','critical',120,true),
    (_tenant_id,'m-equipment-pm','Equipment PM','Check oven seals, mixer belts, fryer clean','monthly','Operations','important',60,false),
    (_tenant_id,'m-first-aid','First aid kit check','Restock consumables, check expiration','monthly','Safety','important',10,false),
    (_tenant_id,'m-posters-check','Compliance posters review','Wage, OSHA, food safety posters current','monthly','Compliance','routine',10,false),
    (_tenant_id,'m-menu-costing','Menu costing review','Update food cost vs invoice prices','monthly','Finance','important',90,false),
    (_tenant_id,'m-pnl-review','Monthly P&L review','Review sales, costs, labor, occupancy','monthly','Finance','important',60,false),
    (_tenant_id,'q-hood-clean','Professional hood cleaning','NFPA 96 certified cleaner','quarterly','Fire Safety','critical',180,true),
    (_tenant_id,'q-ansul-inspect','Ansul/fire suppression inspection','Certified vendor semi-annual per NFPA 17','quarterly','Fire Safety','critical',60,true),
    (_tenant_id,'q-backflow-test','Backflow prevention test','Licensed plumber, certified test','quarterly','Compliance','important',90,true),
    (_tenant_id,'q-deep-clean','Quarterly deep clean','Hood interior, walk-in coils, hard-to-reach','quarterly','Cleaning','important',240,false),
    (_tenant_id,'a-fire-service','Annual fire extinguisher service','NFPA 10: certified service, new tag','annual','Fire Safety','critical',30,true),
    (_tenant_id,'a-dbpr-renew','DBPR license renewal','Renew food service license','annual','Compliance','critical',60,false),
    (_tenant_id,'a-local-btr','Local business tax receipt','Renew BTR with city/county','annual','Compliance','important',30,false)
  on conflict do nothing;

  -- License templates
  insert into licenses (tenant_id, name, agency, status) values
    (_tenant_id, 'DBPR Food Service License', 'FL DBPR', 'active'),
    (_tenant_id, 'Local Business Tax Receipt', 'County/City', 'active'),
    (_tenant_id, 'Fire Permit', 'Local Fire Marshal', 'active')
  on conflict do nothing;
end $fn$;
;
