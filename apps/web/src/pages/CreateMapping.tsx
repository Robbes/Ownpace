// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import React, { useState } from 'react';
// One bilingual string on a screen that had none (0024's rule: the FRAME is
// translated). The rest of this wizard is still EN-only prose — a 0024 T5
// candidate — but a new user-facing sentence does not get to add to that debt.
import { useT } from '../i18n';
import type { StringKey } from '../i18n';
import { useNavigate } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Server,
  Database,
  Settings,
  Clock,
  FileText,
  Calendar,
  Users,
  Folder,
  AlertCircle
} from 'lucide-react';
import { mappingApi } from '../services/mapping-service';
import { serverMessage } from '../services/api';
import { useMutation } from '@tanstack/react-query';
import { ConfirmMigration } from '../components/ConfirmMigration';

type Step = 'source' | 'target' | 'credentials' | 'data-types' | 'schedule' | 'review';

// Matches the shared/API domain enum so the wizard submits a schema-valid config.
type Domain = 'email' | 'calendar' | 'contact' | 'file';

interface FormData {
  name: string;
  sourceType: 'imap' | 'oauth2' | 'graph';
  targetType: 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav';
  sourceHost: string;
  sourcePort: number;
  sourceUsername: string;
  sourcePassword: string;
  sourceSsl: boolean;
  targetHost: string;
  targetPort: number;
  targetUsername: string;
  targetPassword: string;
  targetSsl: boolean;
  domains: Domain[];
  schedule: string;
}

const initialFormData: FormData = {
  name: '',
  sourceType: 'imap',
  targetType: 'jmap',
  sourceHost: '',
  sourcePort: 993,
  sourceUsername: '',
  sourcePassword: '',
  sourceSsl: true,
  targetHost: '',
  targetPort: 443,
  targetUsername: '',
  targetPassword: '',
  targetSsl: true,
  domains: ['email'],
  schedule: '',
};

const steps: { id: Step; nameKey: StringKey; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  { id: 'source', nameKey: 'wizard.step.source', icon: Server },
  { id: 'target', nameKey: 'wizard.step.target', icon: Database },
  { id: 'credentials', nameKey: 'wizard.step.credentials', icon: Settings },
  { id: 'data-types', nameKey: 'wizard.step.dataTypes', icon: FileText },
  { id: 'schedule', nameKey: 'wizard.step.schedule', icon: Clock },
  { id: 'review', nameKey: 'wizard.step.review', icon: Check },
];

const dataTypes: {
  id: Domain;
  nameKey: StringKey;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  hintKey: StringKey;
}[] = [
  { id: 'email', nameKey: 'domain.email', icon: FileText, hintKey: 'wizard.domain.email.hint' },
  { id: 'calendar', nameKey: 'domain.calendar', icon: Calendar, hintKey: 'wizard.domain.calendar.hint' },
  { id: 'contact', nameKey: 'domain.contact', icon: Users, hintKey: 'wizard.domain.contact.hint' },
  { id: 'file', nameKey: 'domain.file', icon: Folder, hintKey: 'wizard.domain.file.hint' },
];

const CreateMapping: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  // 0013 T6: after the (paused) mapping is created, show the discovery + confirm screen
  // instead of navigating away — the migration only starts on the explicit green light.
  const [createdMappingId, setCreatedMappingId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: mappingApi.create,
    onSuccess: (mapping: { id: string }) => {
      setCreatedMappingId(mapping.id);
    },
  });

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Submit form
      const mappingData = {
        name: formData.name,
        sourceType: formData.sourceType,
        targetType: formData.targetType,
        sourceConfig: {
          host: formData.sourceHost,
          port: formData.sourcePort,
          username: formData.sourceUsername,
          password: formData.sourcePassword,
          useSsl: formData.sourceSsl,
        },
        targetConfig: {
          host: formData.targetHost,
          port: formData.targetPort,
          username: formData.targetUsername,
          password: formData.targetPassword,
          useSsl: formData.targetSsl,
        },
        syncConfig: {
          domains: formData.domains,
          schedule: formData.schedule || '0 2 * * *',
        },
      };
      createMutation.mutate(mappingData);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      navigate('/mappings');
    }
  };

  const updateField = (field: keyof FormData, value: string | number | boolean | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleDomain = (domain: Domain) => {
    setFormData((prev) => ({
      ...prev,
      domains: prev.domains.includes(domain)
        ? prev.domains.filter((d) => d !== domain)
        : [...prev.domains, domain],
    }));
  };

  // Each step's gate checks only fields that step RENDERS (0037 T1, pulled
  // forward into 0033 T3 because no wizard test can exist without it): the
  // old source/target gates required sourceUsername/targetUsername — inputs
  // that render two steps later, on 'credentials' — so Next was disabled
  // forever on the first screen, with no message, and the wizard could not
  // be completed at all. The username requirement now lives on the step
  // that shows the fields.
  const canProceed = () => {
    switch (steps[currentStep].id) {
      case 'source':
        return Boolean(formData.sourceHost && formData.sourcePort);
      case 'target':
        return Boolean(formData.targetHost && formData.targetPort);
      case 'credentials':
        return (
          formData.name.trim() !== '' &&
          Boolean(formData.sourceUsername && formData.targetUsername)
        );
      case 'data-types':
        return formData.domains.length > 0;
      case 'schedule':
        return true; // Schedule is optional
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const renderStep = () => {
    switch (steps[currentStep].id) {
      case 'source':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('wizard.selectSource')}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(
                  [
                    { id: 'imap', name: 'IMAP', hintKey: 'wizard.proto.imap.hint' },
                    { id: 'oauth2', name: 'OAuth2', hintKey: 'wizard.proto.oauth2.hint' },
                    { id: 'graph', name: 'Microsoft Graph', hintKey: 'wizard.proto.graph.hint' },
                  ] as const
                ).map((type) => (
                  <button
                    key={type.id}
                    onClick={() => updateField('sourceType', type.id)}
                    className={`p-4 border-2 rounded-lg text-left transition-colors ${
                      formData.sourceType === type.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{type.name}</p>
                    <p className="text-sm text-gray-500 mt-1">{t(type.hintKey)}</p>
                  </button>
                ))}
              </div>
              {/* ADR-0011's own consequence, and it belongs where the choice is
                  made rather than in a doc nobody opens: whatever server the
                  owner points this at is THEIRS. We migrate into it; we do not
                  run it, monitor it, back it up, or carry an SLA for it. Said
                  before the connection details are typed, not after. */}
              <p className="mt-4 text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                {t('createMapping.target.userOperated')}
              </p>

            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Host
                </label>
                <input
                  type="text"
                  value={formData.sourceHost}
                  onChange={(e) => updateField('sourceHost', e.target.value)}
                  className="input w-full"
                  placeholder="imap.example.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    value={formData.sourcePort}
                    onChange={(e) => updateField('sourcePort', parseInt(e.target.value))}
                    className="input w-full"
                    placeholder="993"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="sourceSsl"
                    checked={formData.sourceSsl}
                    onChange={(e) => updateField('sourceSsl', e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="sourceSsl" className="ml-2 block text-sm text-gray-700">
                    Use SSL/TLS
                  </label>
                </div>
              </div>
            </div>
          </div>
        );

      case 'target':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('wizard.selectTarget')}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(
                  [
                    { id: 'jmap', name: 'JMAP', hintKey: 'wizard.proto.jmap.hint' },
                    { id: 'imap', name: 'IMAP', hintKey: 'wizard.proto.imap.hint' },
                    { id: 'caldav', name: 'CalDAV', hintKey: 'wizard.proto.caldav.hint' },
                    { id: 'carddav', name: 'CardDAV', hintKey: 'wizard.proto.carddav.hint' },
                    { id: 'webdav', name: 'WebDAV', hintKey: 'wizard.proto.webdav.hint' },
                  ] as const
                ).map((type) => (
                  <button
                    key={type.id}
                    onClick={() => updateField('targetType', type.id)}
                    className={`p-4 border-2 rounded-lg text-left transition-colors ${
                      formData.targetType === type.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{type.name}</p>
                    <p className="text-sm text-gray-500 mt-1">{t(type.hintKey)}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Host
                </label>
                <input
                  type="text"
                  value={formData.targetHost}
                  onChange={(e) => updateField('targetHost', e.target.value)}
                  className="input w-full"
                  placeholder="jmap.example.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    value={formData.targetPort}
                    onChange={(e) => updateField('targetPort', parseInt(e.target.value))}
                    className="input w-full"
                    placeholder="443"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="targetSsl"
                    checked={formData.targetSsl}
                    onChange={(e) => updateField('targetSsl', e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="targetSsl" className="ml-2 block text-sm text-gray-700">
                    Use SSL/TLS
                  </label>
                </div>
              </div>
            </div>
          </div>
        );

      case 'credentials':
        return (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('wizard.migrationName')}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="input w-full"
                placeholder="My Migration"
              />
              <p className="mt-1 text-sm text-gray-500">{t('wizard.migrationNameHint')}</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">{t('wizard.credentials')}</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.sourceUsername')}
                  </label>
                  <input
                    type="text"
                    value={formData.sourceUsername}
                    onChange={(e) => updateField('sourceUsername', e.target.value)}
                    className="input w-full"
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.sourcePassword')}
                  </label>
                  <input
                    type="password"
                    value={formData.sourcePassword}
                    onChange={(e) => updateField('sourcePassword', e.target.value)}
                    className="input w-full"
                    placeholder="••••••••"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.targetUsername')}
                  </label>
                  <input
                    type="text"
                    value={formData.targetUsername}
                    onChange={(e) => updateField('targetUsername', e.target.value)}
                    className="input w-full"
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.targetPassword')}
                  </label>
                  <input
                    type="password"
                    value={formData.targetPassword}
                    onChange={(e) => updateField('targetPassword', e.target.value)}
                    className="input w-full"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 'data-types':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">
              {t('wizard.selectDataTypes')}
            </h3>
            <p className="text-sm text-gray-500">{t('wizard.selectDataTypesHint')}</p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {dataTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => toggleDomain(type.id)}
                  className={`p-4 border-2 rounded-lg text-left transition-colors ${
                    formData.domains.includes(type.id)
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center">
                    <type.icon
                      className={`w-6 h-6 mr-3 ${
                        formData.domains.includes(type.id)
                          ? 'text-blue-600'
                          : 'text-gray-400'
                      }`}
                    />
                    <div>
                      <p className="font-medium text-gray-900">{t(type.nameKey)}</p>
                      <p className="text-sm text-gray-500">{t(type.hintKey)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 'schedule':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('wizard.schedule')}</h3>
              <p className="text-sm text-gray-500 mb-4">{t('wizard.scheduleHint')}</p>

              <div className="space-y-3">
                {(
                  [
                    { value: '0 * * * *', labelKey: 'wizard.schedule.hourly', hintKey: 'wizard.schedule.hourly.hint' },
                    { value: '0 2 * * *', labelKey: 'wizard.schedule.daily', hintKey: 'wizard.schedule.daily.hint' },
                    { value: '0 */6 * * *', labelKey: 'wizard.schedule.sixHourly', hintKey: 'wizard.schedule.sixHourly.hint' },
                    { value: '*/15 * * * *', labelKey: 'wizard.schedule.quarterHourly', hintKey: 'wizard.schedule.quarterHourly.hint' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateField('schedule', option.value)}
                    className={`w-full p-4 border-2 rounded-lg text-left transition-colors ${
                      formData.schedule === option.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{t(option.labelKey)}</p>
                    <p className="text-sm text-gray-500">{t(option.hintKey)}</p>
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('wizard.customCron')}
                </label>
                <input
                  type="text"
                  value={formData.schedule}
                  onChange={(e) => updateField('schedule', e.target.value)}
                  className="input w-full"
                  placeholder="0 2 * * *"
                />
                <p className="mt-1 text-xs text-gray-500">{t('wizard.customCronHint')}</p>
              </div>
            </div>
          </div>
        );

      case 'review':
        return (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center">
                <Check className="w-5 h-5 text-green-600 mr-2" />
                <h3 className="font-medium text-green-900">{t('wizard.readyToCreate')}</h3>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">{t('wizard.reviewDetails')}</h4>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-gray-500">{t('wizard.review.name')}</dt>
                    <dd className="text-sm font-medium text-gray-900">{formData.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">{t('wizard.review.source')}</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {formData.sourceType} ({formData.sourceHost}:{formData.sourcePort})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">{t('wizard.review.target')}</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {formData.targetType} ({formData.targetHost}:{formData.targetPort})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">{t('wizard.review.schedule')}</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {formData.schedule || t('wizard.review.scheduleDefault')}
                    </dd>
                  </div>
                </dl>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">{t('wizard.review.dataTypes')}</h4>
                <div className="flex flex-wrap gap-2">
                  {formData.domains.map((domain) => (
                    <span
                      key={domain}
                      className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full"
                    >
                      {t(`domain.${domain}` as StringKey)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800">
                  <strong>{t('wizard.review.noteLead')}</strong> {t('wizard.review.note')}
                </p>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // After create, the mapping exists but is PAUSED — show discovery + the green light.
  if (createdMappingId) {
    return (
      <div className="max-w-4xl mx-auto">
        <ConfirmMigration mappingId={createdMappingId} onStarted={() => navigate('/mappings')} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('wizard.title')}</h1>
        <p className="text-gray-500 mt-1">{t('wizard.subtitle')}</p>
      </div>

      {/* Progress Steps */}
      <nav aria-label="Progress">
        <ol className="flex items-center">
          {steps.map((step, index) => (
            <li key={step.id} className={`relative ${index !== steps.length - 1 ? 'flex-1' : ''}`}>
              <div
                className={`flex items-center ${
                  index <= currentStep ? 'text-blue-600' : 'text-gray-400'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                    index < currentStep
                      ? 'bg-blue-600 border-blue-600'
                      : index === currentStep
                      ? 'bg-white border-blue-600'
                      : 'bg-white border-gray-300'
                  }`}
                >
                  {index < currentStep ? (
                    <Check className="w-5 h-5 text-white" />
                  ) : (
                    <step.icon className="w-5 h-5" />
                  )}
                </div>
                <span className="ml-2 text-sm font-medium">{t(step.nameKey)}</span>
              </div>
              {index !== steps.length - 1 && (
                <div
                  className={`absolute top-4 left-0 right-0 h-0.5 ${
                    index < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                  style={{ left: '4rem' }}
                />
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* Step Content */}
      <div className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
        {renderStep()}
      </div>

      {/* A failed submit says so, with the SERVER's words (0033 T3). Before
          this block, createMutation.isError rendered nothing anywhere: the
          operator clicked "Create Migration" and the button simply returned
          to rest. The form stays — no data loss — and the message names what
          the server refused. */}
      {createMutation.isError && (
        <div className="mt-6 flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('createMapping.createFailed')}</p>
            <p className="mt-1">{serverMessage(createMutation.error)}</p>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="mt-6 flex justify-between">
        <button
          onClick={handleBack}
          className="flex items-center px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          {currentStep === 0 ? t('wizard.cancel') : t('wizard.back')}
        </button>

        <button
          onClick={handleNext}
          disabled={!canProceed() || createMutation.isPending}
          className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {createMutation.isPending ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
              {t('wizard.creating')}
            </>
          ) : (
            <>
              {currentStep === steps.length - 1 ? t('wizard.create') : t('wizard.next')}
              <ArrowRight className="w-5 h-5 ml-2" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default CreateMapping;
